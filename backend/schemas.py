"""Pydantic API schemas for ref-db."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class HeadPose(BaseModel):
    yaw: float
    pitch: float
    roll: float = 0.0
    cx: float = 0.5
    cy: float = 0.5
    size: float = 0.2


class TorsoPose(BaseModel):
    yaw: float
    lean: float
    cx: float = 0.5
    cy: float = 0.5
    span: float = 0.2


class SubjectPose(BaseModel):
    head: HeadPose | None = None
    torso: TorsoPose | None = None


class PosesPayload(BaseModel):
    heads: list[HeadPose] = Field(default_factory=list)
    torsos: list[TorsoPose] = Field(default_factory=list)
    subjects: list[SubjectPose] = Field(default_factory=list)


class TagInfo(BaseModel):
    id: int
    name: str
    color: str = "#5b8cff"
    image_count: int = 0


class ImageTagsUpdate(BaseModel):
    tags: list[str] = Field(default_factory=list)


class BatchTagsRequest(BaseModel):
    image_ids: list[int] = Field(default_factory=list)
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)


class SearchRequest(BaseModel):
    query: str = ""
    folder_id: int | None = None
    tag_ids: list[int] = Field(default_factory=list)
    tag_mode: Literal["all", "any"] = "all"
    use_head_yaw: bool = False
    head_yaw: float = Field(default=0.0, ge=-90.0, le=90.0)
    use_head_pitch: bool = False
    head_pitch: float = Field(default=0.0, ge=-60.0, le=60.0)
    head_tol: float = Field(default=20.0, ge=1.0, le=90.0)
    use_torso_yaw: bool = False
    torso_yaw: float = Field(default=0.0, ge=-180.0, le=180.0)
    use_torso_lean: bool = False
    torso_lean: float = Field(default=0.0, ge=-60.0, le=60.0)
    torso_tol: float = Field(default=25.0, ge=1.0, le=180.0)
    match_mode: Literal["paired", "independent"] = "paired"
    top_k: int = Field(default=36, ge=1, le=200)


class SearchMatch(BaseModel):
    id: int
    folder_id: int | None = None
    path: str
    filename: str
    width: int
    height: int
    score: float
    pose_score: float
    thumb_url: str
    file_url: str
    poses: PosesPayload
    tags: list[TagInfo] = Field(default_factory=list)
    source_type: str = "folder"


class SearchResponse(BaseModel):
    matches: list[SearchMatch]
    total_matches: int
    total_indexed: int
    elapsed_ms: float


class ImageDetail(BaseModel):
    id: int
    folder_id: int | None = None
    path: str
    filename: str
    mtime: float
    size_bytes: int
    width: int
    height: int
    indexed_at: float
    thumb_url: str
    file_url: str
    poses: PosesPayload
    tags: list[TagInfo] = Field(default_factory=list)
    source_type: str = "folder"
    content_hash: str | None = None


class BatchDeleteRequest(BaseModel):
    image_ids: list[int] = Field(default_factory=list)


class ImportResponse(BaseModel):
    imported: list[ImageDetail]
    skipped_duplicates: int
    errors: int


class FolderInfo(BaseModel):
    id: int
    path: str
    last_indexed_at: float | None = None
    created_at: float
    image_count: int


class IndexStartRequest(BaseModel):
    folder_path: str


class IndexStatus(BaseModel):
    running: bool = False
    cancelling: bool = False
    folder_path: str | None = None
    phase: str = "idle"
    processed: int = 0
    total: int = 0
    added: int = 0
    updated: int = 0
    skipped_unchanged: int = 0
    pruned: int = 0
    errors: int = 0
    current_file: str | None = None
    message: str = "Idle"


class AppSettingsResponse(BaseModel):
    image_max_edge: int
    thumb_max_size: int
    pose_max_edge: int
    embed_batch_size: int
    models_dir: str
    data_dir: str


class AppSettingsUpdate(BaseModel):
    image_max_edge: int = Field(ge=0, le=16384)


class HealthResponse(BaseModel):
    status: str
    device: str
    dtype: str
    model_loaded: bool
    gpu_name: str | None = None
    vram_total_mb: int | None = None
    total_images: int
    total_folders: int
    image_max_edge: int
