"""FastAPI integration tests for self-contained JPEG storage, import, and delete."""

import json
import time
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from backend.api import create_app
from backend.config import Settings
from backend.thumbnails import (
    compute_dhash,
    ref_filename_for_hash,
    save_managed_ref,
    save_thumbnail,
    sha256_bytes,
    thumb_filename_for_key,
)


class FakeEmbedder:
    def warmup(self) -> None:
        return None

    def get_device_info(self) -> dict:
        return {
            "device": "cpu",
            "dtype": "float32",
            "loaded": True,
            "gpu_name": None,
            "vram_total_mb": None,
        }

    def embed_images(self, images) -> np.ndarray:
        out = np.zeros((len(images), 4), dtype=np.float32)
        out[:, 0] = 1.0
        return out

    def embed_text(self, query: str) -> np.ndarray:
        vec = np.zeros(4, dtype=np.float32)
        vec[0] = 1.0
        return vec


def test_api_self_contained_storage_import_and_delete(tmp_path: Path):
    cfg = Settings(
        project_root=tmp_path,
        data_dir=tmp_path / "data",
        db_path=tmp_path / "data" / "test.db",
        refs_dir=tmp_path / "data" / "refs",
        thumbs_dir=tmp_path / "data" / "thumbs",
        models_dir=tmp_path / ".models",
        hf_cache_dir=tmp_path / ".models" / "huggingface",
        mediapipe_dir=tmp_path / ".models" / "mediapipe",
        frontend_dist_dir=tmp_path / "frontend" / "dist",
        image_max_edge=1920,
    )
    app = create_app(cfg=cfg, embedder=FakeEmbedder())  # type: ignore[arg-type]

    # Pre-populate one stored reference whose original source file was deleted
    hero_arr = np.zeros((1200, 2400, 3), dtype=np.uint8)
    hero_arr[:, :1200, :] = (200, 80, 40)
    hero_arr[:, 1200:, :] = (20, 40, 80)
    pil_large = Image.fromarray(hero_arr, mode="RGB")
    buf = BytesIO()
    pil_large.save(buf, format="PNG")
    c_hash = sha256_bytes(buf.getvalue())
    ref_name = ref_filename_for_hash(c_hash)
    thumb_name = thumb_filename_for_key(c_hash)

    resized = pil_large.resize((1920, 960))
    save_managed_ref(resized, cfg.refs_dir, ref_name)
    save_thumbnail(resized, cfg.thumbs_dir, thumb_name, max_size=480)

    db = app.state.db
    folder_id = db.upsert_folder(str(tmp_path / "deleted_source_folder"))
    db.insert_images_batch(
        [
            {
                "folder_id": folder_id,
                "path": "D:/deleted/hero.png",
                "filename": "hero.png",
                "mtime": 1.0,
                "size_bytes": 5000,
                "width": 1920,
                "height": 960,
                "ref_name": ref_name,
                "thumb_name": thumb_name,
                "content_hash": c_hash,
                "dhash": compute_dhash(resized),
                "source_type": "folder",
                "embedding": np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32).tobytes(),
                "poses_json": json.dumps({"heads": [], "torsos": [], "subjects": []}),
                "indexed_at": time.time(),
            }
        ]
    )
    app.state.search_index.reload()

    with TestClient(app) as client:
        # Even though D:/deleted/hero.png doesn't exist, /file serves managed JPEG!
        search_res = client.post("/api/search", json={"query": "hero"})
        assert search_res.status_code == 200
        matches = search_res.json()["matches"]
        assert len(matches) == 1
        image_id = matches[0]["id"]

        file_res = client.get(f"/api/images/{image_id}/file")
        assert file_res.status_code == 200
        assert file_res.headers["content-type"] == "image/jpeg"
        with Image.open(BytesIO(file_res.content)) as served:
            assert served.format == "JPEG"
            assert served.size == (1920, 960)

        # Unlink folder keeps the stored ref safely in ref-db
        del_folder = client.delete(f"/api/folders/{folder_id}")
        assert del_folder.status_code == 200
        assert del_folder.json()["total_indexed"] == 1
        assert client.get(f"/api/images/{image_id}/file").status_code == 200

        # Direct paste/upload import works and deduplicates identical content
        up_arr = np.zeros((1100, 2200, 4), dtype=np.uint8)
        up_arr[:550, :, :] = (30, 180, 90, 255)
        up_arr[550:, :, :] = (220, 220, 220, 255)
        upload_img = Image.fromarray(up_arr, mode="RGBA")
        up_buf = BytesIO()
        upload_img.save(up_buf, format="PNG")
        up_bytes = up_buf.getvalue()

        imp1 = client.post(
            "/api/images/import",
            files={"files": ("pasted.png", up_bytes, "image/png")},
            data={"source_type": "paste"},
        )
        assert imp1.status_code == 200
        body1 = imp1.json()
        assert len(body1["imported"]) == 1
        assert body1["imported"][0]["width"] == 1920
        assert body1["imported"][0]["height"] == 960
        assert body1["imported"][0]["source_type"] == "paste"
        new_id = body1["imported"][0]["id"]

        # Re-importing same bytes deduplicates cleanly
        imp2 = client.post(
            "/api/images/import",
            files={"files": ("pasted_again.png", up_bytes, "image/png")},
            data={"source_type": "paste"},
        )
        assert imp2.status_code == 200
        assert len(imp2.json()["imported"]) == 0
        assert imp2.json()["skipped_duplicates"] == 1

        # Re-importing a resized JPEG version of the exact same hero image catches near-duplicate!
        recomp_buf = BytesIO()
        pil_large.resize((800, 400)).save(recomp_buf, format="JPEG", quality=70)
        imp3 = client.post(
            "/api/images/import",
            files={"files": ("hero_pinterest.jpg", recomp_buf.getvalue(), "image/jpeg")},
            data={"source_type": "upload"},
        )
        assert imp3.status_code == 200
        assert len(imp3.json()["imported"]) == 0
        assert imp3.json()["skipped_duplicates"] == 1

        # Delete single image permanently removes DB row, stored .jpg, and .webp
        del_img = client.delete(f"/api/images/{new_id}")
        assert del_img.status_code == 200
        assert del_img.json()["refs_removed"] == 1
        assert del_img.json()["thumbs_removed"] == 1
        assert client.get(f"/api/images/{new_id}/file").status_code == 404
