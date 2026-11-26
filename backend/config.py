"""Application configuration and local cache paths."""

from __future__ import annotations

import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime settings for ref-db, overridable via REF_DB_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="REF_DB_",
        env_file=".env",
        extra="ignore",
    )

    project_root: Path = PROJECT_ROOT
    data_dir: Path = PROJECT_ROOT / "data"
    db_path: Path = PROJECT_ROOT / "data" / "reference_index.db"
    refs_dir: Path = PROJECT_ROOT / "data" / "refs"
    thumbs_dir: Path = PROJECT_ROOT / "data" / "thumbs"
    models_dir: Path = PROJECT_ROOT / ".models"
    hf_cache_dir: Path = PROJECT_ROOT / ".models" / "huggingface"
    mediapipe_dir: Path = PROJECT_ROOT / ".models" / "mediapipe"
    frontend_dist_dir: Path = PROJECT_ROOT / "frontend" / "dist"

    siglip_model_id: str = "google/siglip-base-patch16-224"
    face_task_url: str = (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/latest/face_landmarker.task"
    )
    pose_task_url: str = (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
    )

    # Reduce-only longest-side resize config (px) while preserving aspect ratio.
    # 0 disables reduce-only resizing for full-image processing/serving.
    image_max_edge: int = 1920
    ref_jpeg_quality: int = 92
    pose_max_edge: int = 1024
    thumb_max_size: int = 480
    thumb_quality: int = 82
    embed_batch_size: int = 16
    dedup_dhash_max_dist: int = 4
    dedup_siglip_min_sim: float = 0.96

    host: str = "127.0.0.1"
    port: int = 8000
    supported_exts: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

    def ensure_dirs_and_env(self) -> None:
        """Create local runtime directories and pin Hugging Face caches inside the project."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.refs_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.hf_cache_dir.mkdir(parents=True, exist_ok=True)
        self.mediapipe_dir.mkdir(parents=True, exist_ok=True)

        hf_cache_str = str(self.hf_cache_dir.resolve())
        os.environ["HF_HOME"] = hf_cache_str
        os.environ["HUGGINGFACE_HUB_CACHE"] = str((self.hf_cache_dir / "hub").resolve())
        os.environ["TRANSFORMERS_CACHE"] = hf_cache_str
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


settings = Settings()
