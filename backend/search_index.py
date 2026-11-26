"""In-memory vectorized semantic + 3D pose search index."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np

from backend.db import Database
from backend.schemas import SearchMatch, SearchRequest, SearchResponse
from backend.thumbnails import hamming_distance_hex


def angular_diff(a: float, b: float) -> float:
    """Shortest circular distance between two angles in degrees (-180..180)."""
    diff = (a - b + 180.0) % 360.0 - 180.0
    return abs(diff)


def _head_error(head: dict, req: SearchRequest) -> float | None:
    """Return normalized error in [0, 1] if head satisfies active filters, else None."""
    errors: list[float] = []
    if req.use_head_yaw:
        err = abs(head["yaw"] - req.head_yaw)
        if err > req.head_tol:
            return None
        errors.append(err / max(req.head_tol, 1e-6))
    if req.use_head_pitch:
        err = abs(head["pitch"] - req.head_pitch)
        if err > req.head_tol:
            return None
        errors.append(err / max(req.head_tol, 1e-6))
    return float(sum(errors) / len(errors)) if errors else 0.0


def _torso_error(torso: dict, req: SearchRequest) -> float | None:
    """Return normalized error in [0, 1] if torso satisfies active filters, else None."""
    errors: list[float] = []
    if req.use_torso_yaw:
        err = angular_diff(torso["yaw"], req.torso_yaw)
        if err > req.torso_tol:
            return None
        errors.append(err / max(req.torso_tol, 1e-6))
    if req.use_torso_lean:
        err = abs(torso["lean"] - req.torso_lean)
        if err > req.torso_tol:
            return None
        errors.append(err / max(req.torso_tol, 1e-6))
    return float(sum(errors) / len(errors)) if errors else 0.0


def evaluate_pose_match(poses: dict, req: SearchRequest) -> tuple[bool, float]:
    """
    Evaluate whether an image's poses satisfy the active angle filters.
    Returns (matched, pose_closeness_score in [0, 1]).
    """
    need_head = req.use_head_yaw or req.use_head_pitch
    need_torso = req.use_torso_yaw or req.use_torso_lean

    if not need_head and not need_torso:
        return True, 1.0

    heads = poses.get("heads", [])
    torsos = poses.get("torsos", [])
    subjects = poses.get("subjects", [])

    if req.match_mode == "paired" and need_head and need_torso and subjects:
        best_err: float | None = None
        for subj in subjects:
            h = subj.get("head")
            t = subj.get("torso")
            if h is None or t is None:
                continue
            h_err = _head_error(h, req)
            if h_err is None:
                continue
            t_err = _torso_error(t, req)
            if t_err is None:
                continue
            combined = 0.5 * (h_err + t_err)
            if best_err is None or combined < best_err:
                best_err = combined
        if best_err is None:
            return False, 0.0
        return True, round(max(0.0, 1.0 - best_err), 4)

    # Independent matching (or single-part query)
    head_best: float | None = None
    if need_head:
        for h in heads:
            err = _head_error(h, req)
            if err is not None and (head_best is None or err < head_best):
                head_best = err
        if head_best is None:
            return False, 0.0

    torso_best: float | None = None
    if need_torso:
        for t in torsos:
            err = _torso_error(t, req)
            if err is not None and (torso_best is None or err < torso_best):
                torso_best = err
        if torso_best is None:
            return False, 0.0

    parts = [e for e in (head_best, torso_best) if e is not None]
    avg_err = sum(parts) / len(parts) if parts else 0.0
    return True, round(max(0.0, 1.0 - avg_err), 4)


@dataclass
class _Entry:
    id: int
    folder_id: int | None
    path: str
    filename: str
    width: int
    height: int
    thumb_name: str
    dhash: str
    source_type: str
    poses: dict
    tags: list[dict]
    tag_ids: frozenset[int]


class SearchIndex:
    """Thread-safe in-memory index for fast vectorized semantic + pose queries."""

    def __init__(self, db: Database) -> None:
        self.db = db
        self._lock = threading.RLock()
        self._entries: list[_Entry] = []
        self._embeddings: np.ndarray | None = None
        self.reload()

    def reload(self) -> int:
        rows = self.db.load_all_for_index()
        entries: list[_Entry] = []
        vecs: list[np.ndarray] = []

        for r in rows:
            vec = np.frombuffer(r["embedding"], dtype=np.float32)
            tags = r.get("tags", [])
            entries.append(
                _Entry(
                    id=r["id"],
                    folder_id=r["folder_id"],
                    path=r["path"],
                    filename=r["filename"],
                    width=r["width"],
                    height=r["height"],
                    thumb_name=r["thumb_name"],
                    dhash=r.get("dhash", ""),
                    source_type=r.get("source_type", "folder"),
                    poses=r["poses"],
                    tags=tags,
                    tag_ids=frozenset(t["id"] for t in tags),
                )
            )
            vecs.append(vec)

        matrix = np.vstack(vecs).astype(np.float32, copy=False) if vecs else None

        with self._lock:
            self._entries = entries
            self._embeddings = matrix
            return len(entries)

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._entries)

    def has_near_duplicate(
        self,
        dhash: str,
        embedding: np.ndarray,
        max_dhash_dist: int = 4,
        min_siglip_sim: float = 0.96,
    ) -> bool:
        """
        Check whether a visually near-identical image (e.g. recompressed or resized
        version of the same reference) already exists in the index.
        """
        if not dhash:
            return False
        with self._lock:
            entries = self._entries
            embeddings = self._embeddings
        if not entries or embeddings is None:
            return False

        emb_f32 = embedding.astype(np.float32, copy=False)
        for idx, entry in enumerate(entries):
            if not entry.dhash:
                continue
            if hamming_distance_hex(dhash, entry.dhash) <= max_dhash_dist:
                if float(np.dot(emb_f32, embeddings[idx])) >= min_siglip_sim:
                    return True
        return False

    def search(self, req: SearchRequest, text_embedding: np.ndarray | None) -> SearchResponse:
        t0 = time.perf_counter()
        with self._lock:
            entries = self._entries
            embeddings = self._embeddings

        if not entries:
            return SearchResponse(
                matches=[],
                total_matches=0,
                total_indexed=0,
                elapsed_ms=round((time.perf_counter() - t0) * 1000.0, 2),
            )

        has_query = text_embedding is not None
        scores_vec = (
            embeddings @ text_embedding.astype(np.float32, copy=False)
            if (has_query and embeddings is not None)
            else None
        )

        req_tag_ids = set(req.tag_ids)
        candidates: list[tuple[float, _Entry, float, float]] = []
        for idx, entry in enumerate(entries):
            if req.folder_id is not None and entry.folder_id != req.folder_id:
                continue

            if req_tag_ids:
                if req.tag_mode == "all" and not req_tag_ids.issubset(entry.tag_ids):
                    continue
                if req.tag_mode == "any" and not (req_tag_ids & entry.tag_ids):
                    continue

            pose_ok, pose_score = evaluate_pose_match(entry.poses, req)
            if not pose_ok:
                continue

            sem_score = float(scores_vec[idx]) if scores_vec is not None else pose_score
            rank_score = sem_score if has_query else pose_score
            candidates.append((rank_score, entry, sem_score, pose_score))

        candidates.sort(key=lambda item: item[0], reverse=True)
        total_matches = len(candidates)
        top = candidates[: req.top_k]

        matches = [
            SearchMatch(
                id=entry.id,
                folder_id=entry.folder_id,
                path=entry.path,
                filename=entry.filename,
                width=entry.width,
                height=entry.height,
                score=round(sem_score, 4),
                pose_score=pose_score,
                thumb_url=f"/api/images/{entry.id}/thumb",
                file_url=f"/api/images/{entry.id}/file",
                poses=entry.poses,
                tags=entry.tags,
                source_type=entry.source_type,
            )
            for _, entry, sem_score, pose_score in top
        ]

        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        return SearchResponse(
            matches=matches,
            total_matches=total_matches,
            total_indexed=len(entries),
            elapsed_ms=elapsed_ms,
        )
