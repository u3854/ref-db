"""FastAPI application and REST/SSE routes for ref-db."""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.config import Settings, settings
from backend.db import Database
from backend.indexer import IndexManager
from backend.ml.siglip import SigLIPEmbedder
from backend.schemas import (
    AppSettingsResponse,
    AppSettingsUpdate,
    BatchDeleteRequest,
    BatchTagsRequest,
    FolderInfo,
    HealthResponse,
    ImageDetail,
    ImageTagsUpdate,
    ImportResponse,
    IndexStartRequest,
    IndexStatus,
    LibraryStatsResponse,
    SearchRequest,
    SearchResponse,
    TagInfo,
)
from backend.search_index import SearchIndex
from backend.thumbnails import remove_stored_files


def _pick_folder_dialog() -> str | None:
    """Open an OS folder picker dialog synchronously on a worker thread."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(title="Select Art Reference Folder")
        return selected or None
    finally:
        root.destroy()


def create_app(
    cfg: Settings = settings,
    embedder: SigLIPEmbedder | None = None,
) -> FastAPI:
    cfg.ensure_dirs_and_env()
    db = Database(cfg.db_path)
    search_index = SearchIndex(db)
    ml_embedder = embedder or SigLIPEmbedder(cfg)
    indexer = IndexManager(db=db, search_index=search_index, embedder=ml_embedder, cfg=cfg)
    shutdown_event = threading.Event()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        search_index.reload()
        yield
        shutdown_event.set()
        indexer.cancel()

    app = FastAPI(title="ref-db", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.cfg = cfg
    app.state.db = db
    app.state.search_index = search_index
    app.state.embedder = ml_embedder
    app.state.indexer = indexer

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        dev = ml_embedder.get_device_info()
        total_images, total_folders = db.get_stats()
        return HealthResponse(
            status="ok",
            device=dev["device"],
            dtype=dev["dtype"],
            model_loaded=dev["loaded"],
            gpu_name=dev["gpu_name"],
            vram_total_mb=dev["vram_total_mb"],
            total_images=total_images,
            total_folders=total_folders,
            image_max_edge=db.get_image_max_edge(cfg.image_max_edge),
        )

    @app.get("/api/settings", response_model=AppSettingsResponse)
    def get_settings() -> AppSettingsResponse:
        return AppSettingsResponse(
            image_max_edge=db.get_image_max_edge(cfg.image_max_edge),
            thumb_max_size=cfg.thumb_max_size,
            pose_max_edge=cfg.pose_max_edge,
            embed_batch_size=cfg.embed_batch_size,
            models_dir=str(cfg.models_dir.resolve()),
            data_dir=str(cfg.data_dir.resolve()),
        )

    @app.patch("/api/settings", response_model=AppSettingsResponse)
    def update_settings(payload: AppSettingsUpdate) -> AppSettingsResponse:
        new_edge = db.set_image_max_edge(payload.image_max_edge)
        return AppSettingsResponse(
            image_max_edge=new_edge,
            thumb_max_size=cfg.thumb_max_size,
            pose_max_edge=cfg.pose_max_edge,
            embed_batch_size=cfg.embed_batch_size,
            models_dir=str(cfg.models_dir.resolve()),
            data_dir=str(cfg.data_dir.resolve()),
        )

    @app.get("/api/stats", response_model=LibraryStatsResponse)
    def get_library_stats() -> LibraryStatsResponse:
        db_counts = db.get_storage_and_tag_counts()
        idx_counts = search_index.get_summary_counts()
        return LibraryStatsResponse(**db_counts, **idx_counts)

    @app.post("/api/search", response_model=SearchResponse)
    def search(req: SearchRequest) -> SearchResponse:
        query_text = req.query.strip()
        text_emb = ml_embedder.embed_text(query_text) if query_text else None
        anchor_emb: np.ndarray | None = None
        if req.similar_to_image_id is not None:
            anchor_emb = search_index.get_embedding(req.similar_to_image_id)
            if anchor_emb is None:
                raise HTTPException(status_code=404, detail="Anchor reference image not found")

        if text_emb is not None and anchor_emb is not None:
            blended = 0.5 * text_emb.astype(np.float32) + 0.5 * anchor_emb.astype(np.float32)
            norm = float(np.linalg.norm(blended))
            combined_emb = blended / max(norm, 1e-8)
        else:
            combined_emb = anchor_emb if anchor_emb is not None else text_emb

        return search_index.search(req, combined_emb)

    @app.get("/api/images/{image_id}", response_model=ImageDetail)
    def get_image_detail(image_id: int) -> ImageDetail:
        row = db.get_image_by_id(image_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Image not found")
        return ImageDetail(
            id=row["id"],
            folder_id=row["folder_id"],
            path=row["path"],
            filename=row["filename"],
            mtime=row["mtime"],
            size_bytes=row["size_bytes"],
            width=row["width"],
            height=row["height"],
            indexed_at=row["indexed_at"],
            thumb_url=f"/api/images/{row['id']}/thumb",
            file_url=f"/api/images/{row['id']}/file",
            poses=row["poses"],
            tags=row["tags"],
            source_type=row.get("source_type", "folder"),
            content_hash=row.get("content_hash"),
        )

    @app.post("/api/images/import", response_model=ImportResponse)
    async def import_images(
        files: list[UploadFile] = File(...),
        source_type: str = Form(default="upload"),
        tags: str = Form(default="[]"),
    ) -> ImportResponse:
        parsed_tags: list[str] = []
        raw_tags = tags.strip()
        if raw_tags:
            try:
                decoded = json.loads(raw_tags)
                if isinstance(decoded, list):
                    parsed_tags = [str(t) for t in decoded if str(t).strip()]
                elif isinstance(decoded, str) and decoded.strip():
                    parsed_tags = [decoded.strip()]
            except json.JSONDecodeError:
                parsed_tags = [t.strip() for t in raw_tags.split(",") if t.strip()]

        payloads: list[tuple[str, bytes]] = []
        for f in files:
            data = await f.read()
            if data:
                payloads.append((f.filename or "pasted-image.png", data))
        result = await asyncio.to_thread(
            indexer.ingest_bytes_items,
            payloads,
            source_type,
        )
        if parsed_tags and result["imported_ids"]:
            db.batch_modify_tags(
                image_ids=result["imported_ids"],
                add_tags=parsed_tags,
                remove_tags=[],
            )
            search_index.reload()

        imported_details: list[ImageDetail] = []
        for img_id in result["imported_ids"]:
            row = db.get_image_by_id(img_id)
            if row is not None:
                imported_details.append(
                    ImageDetail(
                        id=row["id"],
                        folder_id=row["folder_id"],
                        path=row["path"],
                        filename=row["filename"],
                        mtime=row["mtime"],
                        size_bytes=row["size_bytes"],
                        width=row["width"],
                        height=row["height"],
                        indexed_at=row["indexed_at"],
                        thumb_url=f"/api/images/{row['id']}/thumb",
                        file_url=f"/api/images/{row['id']}/file",
                        poses=row["poses"],
                        tags=row["tags"],
                        source_type=row.get("source_type", source_type),
                        content_hash=row.get("content_hash"),
                    )
                )
        return ImportResponse(
            imported=imported_details,
            skipped_duplicates=result["skipped_duplicates"],
            errors=result["errors"],
        )

    @app.delete("/api/images/{image_id}")
    def delete_image(image_id: int) -> dict[str, int | bool]:
        if db.get_image_by_id(image_id) is None:
            raise HTTPException(status_code=404, detail="Image not found")
        ref_names, thumb_names = db.delete_images_by_ids([image_id])
        refs_removed, thumbs_removed = remove_stored_files(
            cfg.refs_dir, cfg.thumbs_dir, ref_names, thumb_names
        )
        remaining = search_index.reload()
        return {
            "deleted": True,
            "refs_removed": refs_removed,
            "thumbs_removed": thumbs_removed,
            "total_indexed": remaining,
        }

    @app.post("/api/images/batch-delete")
    def batch_delete_images(payload: BatchDeleteRequest) -> dict[str, int]:
        ref_names, thumb_names = db.delete_images_by_ids(payload.image_ids)
        refs_removed, thumbs_removed = remove_stored_files(
            cfg.refs_dir, cfg.thumbs_dir, ref_names, thumb_names
        )
        remaining = search_index.reload()
        return {
            "deleted_count": len(ref_names) or len(thumb_names),
            "refs_removed": refs_removed,
            "thumbs_removed": thumbs_removed,
            "total_indexed": remaining,
        }

    @app.get("/api/tags", response_model=list[TagInfo])
    def list_tags() -> list[TagInfo]:
        return [TagInfo(**t) for t in db.list_tags()]

    @app.put("/api/images/{image_id}/tags", response_model=list[TagInfo])
    def set_image_tags(image_id: int, payload: ImageTagsUpdate) -> list[TagInfo]:
        try:
            updated = db.set_image_tags(image_id, payload.tags)
        except KeyError:
            raise HTTPException(status_code=404, detail="Image not found")
        search_index.reload()
        return [TagInfo(**t) for t in updated]

    @app.post("/api/tags/batch")
    def batch_tags(payload: BatchTagsRequest) -> dict[str, int]:
        res = db.batch_modify_tags(
            image_ids=payload.image_ids,
            add_tags=payload.add_tags,
            remove_tags=payload.remove_tags,
        )
        search_index.reload()
        return res

    @app.delete("/api/tags/{tag_id}")
    def delete_tag(tag_id: int) -> dict[str, bool]:
        if not db.delete_tag(tag_id):
            raise HTTPException(status_code=404, detail="Tag not found")
        search_index.reload()
        return {"deleted": True}

    @app.get("/api/images/{image_id}/thumb")
    def get_image_thumb(image_id: int):
        row = db.get_image_by_id(image_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Image not found")
        thumb_path = cfg.thumbs_dir / row["thumb_name"]
        if not thumb_path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        return FileResponse(
            thumb_path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.get("/api/images/{image_id}/file")
    def get_image_file(image_id: int):
        row = db.get_image_by_id(image_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Image not found")

        ref_name = row.get("ref_name") or ""
        if ref_name:
            ref_path = cfg.refs_dir / ref_name
            if ref_path.exists() and ref_path.is_file():
                stem = Path(row["filename"]).stem or f"ref-{image_id}"
                return FileResponse(
                    ref_path,
                    media_type="image/jpeg",
                    filename=f"{stem}.jpg",
                    content_disposition_type="inline",
                    headers={"Cache-Control": "public, max-age=86400"},
                )

        img_path = Path(row["path"])
        if img_path.exists() and img_path.is_file():
            return FileResponse(
                img_path,
                filename=row["filename"],
                content_disposition_type="inline",
            )
        raise HTTPException(status_code=404, detail="Stored reference file not found")

    @app.get("/api/folders", response_model=list[FolderInfo])
    def list_folders() -> list[FolderInfo]:
        return [FolderInfo(**f) for f in db.list_folders()]

    @app.post("/api/folders/pick")
    async def pick_folder() -> dict[str, str | None]:
        try:
            picked = await asyncio.to_thread(_pick_folder_dialog)
            return {"folder_path": picked}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Folder picker failed: {exc}")

    @app.delete("/api/folders/{folder_id}")
    def delete_folder(
        folder_id: int,
        delete_images: bool = Query(default=False),
    ) -> dict:
        if db.get_folder(folder_id) is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        ref_names, thumb_names = db.delete_folder(folder_id, delete_images=delete_images)
        refs_removed, thumbs_removed = remove_stored_files(
            cfg.refs_dir, cfg.thumbs_dir, ref_names, thumb_names
        )
        remaining = search_index.reload()
        return {
            "deleted": True,
            "removed_refs": refs_removed,
            "removed_thumbnails": thumbs_removed,
            "total_indexed": remaining,
        }

    @app.post("/api/index/start", response_model=IndexStatus)
    def start_index(payload: IndexStartRequest) -> IndexStatus:
        try:
            return indexer.start(payload.folder_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @app.post("/api/index/cancel", response_model=IndexStatus)
    def cancel_index() -> IndexStatus:
        return indexer.cancel()

    @app.get("/api/index/status", response_model=IndexStatus)
    def index_status() -> IndexStatus:
        return indexer.get_status()

    @app.get("/api/index/events")
    async def index_events(request: Request):
        sub_queue = indexer.subscribe()

        async def event_stream():
            try:
                while not shutdown_event.is_set():
                    if await request.is_disconnected():
                        break
                    try:
                        payload = await asyncio.to_thread(sub_queue.get, True, 0.5)
                        yield f"data: {json.dumps(payload)}\n\n"
                    except queue.Empty:
                        yield ": keep-alive\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                indexer.unsubscribe(sub_queue)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Serve built React frontend in production mode
    dist_dir = cfg.frontend_dist_dir
    if dist_dir.exists() and (dist_dir / "index.html").exists():
        assets_dir = dist_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}")
        def serve_spa(full_path: str):
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found")
            candidate = dist_dir / full_path
            if full_path and candidate.exists() and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist_dir / "index.html")

    return app


app = create_app()
