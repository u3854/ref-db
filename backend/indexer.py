"""Self-contained reference importer/indexer with SHA-256 + perceptual dHash deduplication."""

from __future__ import annotations

import json
import queue
import threading
import time
from pathlib import Path

import numpy as np

from backend.config import Settings, settings
from backend.db import Database
from backend.ml.pose import PoseExtractor
from backend.ml.siglip import SigLIPEmbedder
from backend.schemas import IndexStatus
from backend.search_index import SearchIndex
from backend.thumbnails import (
    compute_dhash,
    hamming_distance_hex,
    open_rgb_exif,
    ref_filename_for_hash,
    save_managed_ref,
    save_thumbnail,
    sha256_bytes,
    sha256_file,
    thumb_filename_for_key,
)


class IndexManager:
    """Manages folder imports and direct paste/upload ingestion into data/refs/."""

    def __init__(
        self,
        db: Database,
        search_index: SearchIndex,
        embedder: SigLIPEmbedder,
        cfg: Settings = settings,
    ) -> None:
        self.db = db
        self.search_index = search_index
        self.embedder = embedder
        self.cfg = cfg

        self._lock = threading.Lock()
        self._ingest_lock = threading.Lock()
        self._cancel_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._status = IndexStatus()
        self._subscribers: list[queue.Queue[dict]] = []

    def get_status(self) -> IndexStatus:
        with self._lock:
            return self._status.model_copy()

    def subscribe(self) -> queue.Queue[dict]:
        q: queue.Queue[dict] = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.append(q)
            q.put(self._status.model_dump())
        return q

    def unsubscribe(self, q: queue.Queue[dict]) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _publish(self, **updates) -> None:
        with self._lock:
            for k, v in updates.items():
                setattr(self._status, k, v)
            payload = self._status.model_dump()
            subs = list(self._subscribers)
        for q in subs:
            try:
                if q.full():
                    q.get_nowait()
                q.put_nowait(payload)
            except (queue.Empty, queue.Full):
                pass

    def start(self, folder_path: str) -> IndexStatus:
        folder = Path(folder_path.strip()).expanduser()
        if not folder.exists() or not folder.is_dir():
            raise FileNotFoundError(f"Folder not found: {folder}")

        resolved_folder = str(folder.resolve())
        with self._lock:
            if self._status.running:
                raise RuntimeError("Indexing is already in progress.")
            self._cancel_event.clear()
            self._status = IndexStatus(
                running=True,
                cancelling=False,
                folder_path=resolved_folder,
                phase="scanning",
                message=f"Scanning {resolved_folder}...",
            )

        self._publish()
        self._thread = threading.Thread(
            target=self._run_worker,
            args=(folder.resolve(),),
            daemon=True,
            name="ref-db-indexer",
        )
        self._thread.start()
        return self.get_status()

    def cancel(self) -> IndexStatus:
        with self._lock:
            if not self._status.running:
                return self._status.model_copy()
            self._cancel_event.set()
            self._status.cancelling = True
            self._status.message = "Cancelling after current batch..."
        self._publish()
        return self.get_status()

    def _is_batch_duplicate(
        self,
        dhash: str,
        emb: np.ndarray,
        accepted_in_batch: list[tuple[str, np.ndarray]],
    ) -> bool:
        if self.search_index.has_near_duplicate(
            dhash,
            emb,
            max_dhash_dist=self.cfg.dedup_dhash_max_dist,
            min_siglip_sim=self.cfg.dedup_siglip_min_sim,
        ):
            return True
        for prev_dhash, prev_emb in accepted_in_batch:
            if (
                hamming_distance_hex(dhash, prev_dhash) <= self.cfg.dedup_dhash_max_dist
                and float(np.dot(emb, prev_emb)) >= self.cfg.dedup_siglip_min_sim
            ):
                return True
        return False

    def ingest_bytes_items(
        self,
        items: list[tuple[str, bytes]],
        source_type: str = "upload",
    ) -> dict:
        """
        Synchronously ingest raw image payloads (from browser paste or drag-and-drop)
        into managed JPEG storage without requiring a folder on disk.
        """
        if not items:
            return {"imported_ids": [], "skipped_duplicates": 0, "errors": 0}

        self.cfg.ensure_dirs_and_env()
        self.embedder.warmup()
        max_edge = self.db.get_image_max_edge(self.cfg.image_max_edge)

        with self._ingest_lock:
            existing_hashes = self.db.get_existing_hashes()
            seen_hashes = set(existing_hashes.keys())
            skipped = 0
            errors = 0
            prepared: list[dict] = []
            pil_batch = []

            with PoseExtractor(self.cfg) as pose_extractor:
                for filename, raw_bytes in items:
                    try:
                        c_hash = sha256_bytes(raw_bytes)
                        if c_hash in seen_hashes:
                            prev_ref, prev_thumb = existing_hashes.get(c_hash, ("", ""))
                            if (
                                prev_ref
                                and prev_thumb
                                and (self.cfg.refs_dir / prev_ref).exists()
                                and (self.cfg.thumbs_dir / prev_thumb).exists()
                            ):
                                skipped += 1
                                continue

                        seen_hashes.add(c_hash)
                        pil_img, width, height = open_rgb_exif(
                            raw_bytes,
                            max_edge=max_edge,
                            bg_color=(255, 255, 255),
                        )
                        dhash = compute_dhash(pil_img)
                        poses = pose_extractor.extract(pil_img)
                        prepared.append(
                            {
                                "folder_id": None,
                                "path": filename,
                                "filename": filename,
                                "mtime": time.time(),
                                "width": width,
                                "height": height,
                                "content_hash": c_hash,
                                "dhash": dhash,
                                "source_type": source_type,
                                "poses_json": json.dumps(poses),
                                "pil_img": pil_img,
                            }
                        )
                        pil_batch.append(pil_img)
                    except Exception:
                        errors += 1

            if not pil_batch:
                return {"imported_ids": [], "skipped_duplicates": skipped, "errors": errors}

            embeddings = self.embedder.embed_images(pil_batch)
            accepted_in_batch: list[tuple[str, np.ndarray]] = []
            records: list[dict] = []
            now = time.time()

            for idx, item in enumerate(prepared):
                emb = embeddings[idx]
                pil_img = item.pop("pil_img")
                if self._is_batch_duplicate(item["dhash"], emb, accepted_in_batch):
                    skipped += 1
                    continue

                c_hash = item["content_hash"]
                ref_name = ref_filename_for_hash(c_hash)
                thumb_name = thumb_filename_for_key(c_hash)
                _, stored_bytes = save_managed_ref(
                    pil_img,
                    self.cfg.refs_dir,
                    ref_name,
                    quality=self.cfg.ref_jpeg_quality,
                )
                save_thumbnail(
                    pil_img,
                    self.cfg.thumbs_dir,
                    thumb_name,
                    max_size=self.cfg.thumb_max_size,
                    quality=self.cfg.thumb_quality,
                )

                item["ref_name"] = ref_name
                item["thumb_name"] = thumb_name
                item["size_bytes"] = stored_bytes
                item["embedding"] = emb.tobytes()
                item["indexed_at"] = now
                accepted_in_batch.append((item["dhash"], emb))
                records.append(item)

            inserted_ids = self.db.insert_images_batch(records)
            if inserted_ids:
                self.search_index.reload()
            return {
                "imported_ids": inserted_ids,
                "skipped_duplicates": skipped,
                "errors": errors,
            }

    def _run_worker(self, folder: Path) -> None:
        resolved_folder = str(folder)
        try:
            self.cfg.ensure_dirs_and_env()
            folder_id = self.db.upsert_folder(resolved_folder)
            existing_hashes = self.db.get_existing_hashes()
            seen_hashes = set(existing_hashes.keys())

            exts = {e.lower() for e in self.cfg.supported_exts}
            disk_files = [
                p
                for p in folder.rglob("*")
                if p.is_file() and p.suffix.lower() in exts
            ]

            to_process: list[tuple[Path, str, str, float]] = []
            skipped = 0
            errors = 0

            for path_obj in disk_files:
                if self._cancel_event.is_set():
                    break
                try:
                    c_hash = sha256_file(path_obj)
                    if c_hash in seen_hashes:
                        prev = existing_hashes.get(c_hash)
                        if (
                            prev is not None
                            and prev[0]
                            and prev[1]
                            and (self.cfg.refs_dir / prev[0]).exists()
                            and (self.cfg.thumbs_dir / prev[1]).exists()
                        ):
                            skipped += 1
                            continue
                    seen_hashes.add(c_hash)
                    to_process.append(
                        (path_obj, str(path_obj.resolve()), c_hash, float(path_obj.stat().st_mtime))
                    )
                except Exception:
                    errors += 1

            total = len(to_process)
            self._publish(
                phase="loading_models" if total > 0 else "finalizing",
                total=total,
                skipped_unchanged=skipped,
                pruned=0,
                errors=errors,
                message=(
                    f"Loading models to import {total} image(s)..."
                    if total > 0
                    else f"Up to date ({skipped} duplicate/existing skipped)."
                ),
            )

            if total > 0 and not self._cancel_event.is_set():
                self.embedder.warmup()
                max_edge = self.db.get_image_max_edge(self.cfg.image_max_edge)
                batch_size = max(1, self.cfg.embed_batch_size)
                added = 0
                processed = 0

                with self._ingest_lock, PoseExtractor(self.cfg) as pose_extractor:
                    for start in range(0, total, batch_size):
                        if self._cancel_event.is_set():
                            break
                        chunk = to_process[start : start + batch_size]
                        prepared: list[dict] = []
                        pil_batch = []

                        for path_obj, path_str, c_hash, mtime in chunk:
                            if self._cancel_event.is_set():
                                break
                            self._publish(
                                phase="indexing",
                                current_file=path_obj.name,
                                message=f"Importing {path_obj.name} ({processed + 1}/{total})",
                            )
                            try:
                                pil_img, width, height = open_rgb_exif(
                                    path_obj,
                                    max_edge=max_edge,
                                    bg_color=(255, 255, 255),
                                )
                                dhash = compute_dhash(pil_img)
                                poses = pose_extractor.extract(pil_img)
                                prepared.append(
                                    {
                                        "folder_id": folder_id,
                                        "path": path_str,
                                        "filename": path_obj.name,
                                        "mtime": mtime,
                                        "width": width,
                                        "height": height,
                                        "content_hash": c_hash,
                                        "dhash": dhash,
                                        "source_type": "folder",
                                        "poses_json": json.dumps(poses),
                                        "pil_img": pil_img,
                                    }
                                )
                                pil_batch.append(pil_img)
                            except Exception:
                                errors += 1
                            processed += 1

                        if pil_batch:
                            embeddings = self.embedder.embed_images(pil_batch)
                            accepted_in_batch: list[tuple[str, np.ndarray]] = []
                            db_records: list[dict] = []
                            now = time.time()

                            for idx_item, item in enumerate(prepared):
                                emb = embeddings[idx_item]
                                pil_img = item.pop("pil_img")
                                if self._is_batch_duplicate(item["dhash"], emb, accepted_in_batch):
                                    skipped += 1
                                    continue

                                c_hash = item["content_hash"]
                                ref_name = ref_filename_for_hash(c_hash)
                                thumb_name = thumb_filename_for_key(c_hash)
                                _, stored_bytes = save_managed_ref(
                                    pil_img,
                                    self.cfg.refs_dir,
                                    ref_name,
                                    quality=self.cfg.ref_jpeg_quality,
                                )
                                save_thumbnail(
                                    pil_img,
                                    self.cfg.thumbs_dir,
                                    thumb_name,
                                    max_size=self.cfg.thumb_max_size,
                                    quality=self.cfg.thumb_quality,
                                )

                                item["ref_name"] = ref_name
                                item["thumb_name"] = thumb_name
                                item["size_bytes"] = stored_bytes
                                item["embedding"] = emb.tobytes()
                                item["indexed_at"] = now
                                accepted_in_batch.append((item["dhash"], emb))
                                db_records.append(item)
                                added += 1

                            if db_records:
                                self.db.insert_images_batch(db_records)
                                self.search_index.reload()

                        self._publish(
                            processed=processed,
                            added=added,
                            skipped_unchanged=skipped,
                            errors=errors,
                        )

            self.db.mark_folder_indexed(folder_id)
            total_in_index = self.search_index.reload()
            cancelled = self._cancel_event.is_set()
            final_status = self.get_status()
            final_msg = (
                f"Cancelled. Processed {final_status.processed}/{final_status.total} "
                f"(Total stored refs: {total_in_index})."
                if cancelled
                else f"Done! Imported {final_status.added} new ref(s), skipped {final_status.skipped_unchanged} duplicate(s), "
                f"errors {final_status.errors}. Total stored refs: {total_in_index}."
            )
            self._publish(
                running=False,
                cancelling=False,
                phase="cancelled" if cancelled else "done",
                current_file=None,
                message=final_msg,
            )
        except Exception as exc:
            self._publish(
                running=False,
                cancelling=False,
                phase="error",
                current_file=None,
                message=f"Indexing failed: {exc}",
            )
