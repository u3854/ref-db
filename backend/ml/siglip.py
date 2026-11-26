"""SigLIP semantic image and text embedding wrapper with local project model caching."""

from __future__ import annotations

import threading
from typing import Sequence

import numpy as np
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

from backend.config import Settings, settings


def detect_device_and_dtype() -> tuple[str, torch.dtype]:
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float16
    return "cpu", torch.float32


class SigLIPEmbedder:
    """Lazy-loading, thread-safe SigLIP embedder pinned to project-local HF cache."""

    def __init__(self, cfg: Settings = settings) -> None:
        self.cfg = cfg
        self._lock = threading.Lock()
        self._processor = None
        self._model = None
        self._device: str | None = None
        self._dtype: torch.dtype | None = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def get_device_info(self) -> dict:
        device, dtype = (
            (self._device, self._dtype)
            if self._device is not None
            else detect_device_and_dtype()
        )
        info: dict = {
            "device": device,
            "dtype": str(dtype).replace("torch.", ""),
            "loaded": self.is_loaded,
            "gpu_name": None,
            "vram_total_mb": None,
        }
        if device == "cuda" and torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            info["gpu_name"] = props.name
            info["vram_total_mb"] = int(props.total_memory // (1024 * 1024))
        return info

    def _ensure_loaded(self) -> None:
        if self._model is not None and self._processor is not None:
            return
        with self._lock:
            if self._model is not None and self._processor is not None:
                return
            self.cfg.ensure_dirs_and_env()
            cache_dir = str(self.cfg.hf_cache_dir.resolve())
            device, dtype = detect_device_and_dtype()

            processor = AutoProcessor.from_pretrained(
                self.cfg.siglip_model_id,
                cache_dir=cache_dir,
            )
            model = AutoModel.from_pretrained(
                self.cfg.siglip_model_id,
                torch_dtype=dtype,
                cache_dir=cache_dir,
            ).to(device)
            model.eval()

            self._processor = processor
            self._model = model
            self._device = device
            self._dtype = dtype

    def warmup(self) -> None:
        self._ensure_loaded()

    @staticmethod
    def _l2_normalize(feats: torch.Tensor) -> np.ndarray:
        feats = feats / feats.norm(dim=-1, keepdim=True).clamp(min=1e-12)
        return feats.float().cpu().numpy().astype(np.float32, copy=False)

    @torch.no_grad()
    def _embed_image_chunk(self, images: Sequence[Image.Image]) -> np.ndarray:
        assert self._processor is not None and self._model is not None
        assert self._device is not None and self._dtype is not None

        inputs = self._processor(images=list(images), return_tensors="pt").to(self._device)
        if self._dtype == torch.float16 and "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(torch.float16)

        with self._lock:
            feats = self._model.get_image_features(**inputs)
        # Handle transformers BaseModelOutputWithPooling vs Tensor across versions
        if not isinstance(feats, torch.Tensor):
            feats = feats.pooler_output if hasattr(feats, "pooler_output") else feats[0]
        return self._l2_normalize(feats)

    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        """Compute L2-normalized float32 embeddings (N, D), shrinking batch on CUDA OOM."""
        if not images:
            return np.zeros((0, 768), dtype=np.float32)

        self._ensure_loaded()
        try:
            return self._embed_image_chunk(images)
        except torch.OutOfMemoryError:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            if len(images) == 1:
                raise
            mid = len(images) // 2
            left = self.embed_images(images[:mid])
            right = self.embed_images(images[mid:])
            return np.vstack([left, right])

    @torch.no_grad()
    def embed_text(self, query: str) -> np.ndarray:
        """Compute L2-normalized float32 text embedding (D,)."""
        self._ensure_loaded()
        assert self._processor is not None and self._model is not None
        assert self._device is not None

        inputs = self._processor(
            text=[query],
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        ).to(self._device)

        with self._lock:
            feats = self._model.get_text_features(**inputs)
        if not isinstance(feats, torch.Tensor):
            feats = feats.pooler_output if hasattr(feats, "pooler_output") else feats[0]
        return self._l2_normalize(feats)[0]
