"""Tests for SQLite persistence, white alpha flattening, dHash, and managed JPEG storage."""

import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from backend.db import Database
from backend.thumbnails import (
    compute_dhash,
    hamming_distance_hex,
    open_rgb_exif,
    ref_filename_for_hash,
    remove_stored_files,
    resize_reduce_only,
    save_managed_ref,
    save_thumbnail,
    sha256_bytes,
    thumb_filename_for_key,
)


def test_resize_reduce_only_preserves_aspect_and_never_upscales():
    wide = Image.new("RGB", (3840, 2160), color=(20, 40, 60))
    reduced = resize_reduce_only(wide, 1920)
    assert reduced.size == (1920, 1080)

    tall = Image.new("RGB", (1500, 3000), color=(10, 20, 30))
    reduced_tall = resize_reduce_only(tall, 1920)
    assert reduced_tall.size == (960, 1920)

    small = Image.new("RGB", (800, 600), color=(50, 50, 50))
    not_upscaled = resize_reduce_only(small, 1920)
    assert not_upscaled.size == (800, 600)

    disabled = resize_reduce_only(wide, 0)
    assert disabled.size == (3840, 2160)


def test_alpha_flattens_to_white_and_saves_uniform_jpeg(tmp_path: Path):
    src = tmp_path / "alpha.png"
    rgba = Image.new("RGBA", (2400, 1200), color=(0, 0, 0, 0))
    # Draw a dark square in top-left corner
    for x in range(100):
        for y in range(100):
            rgba.putpixel((x, y), (10, 20, 30, 255))
    rgba.save(src)

    pil_img, w, h = open_rgb_exif(src, max_edge=1920, bg_color=(255, 255, 255))
    assert (w, h) == (1920, 960)
    assert pil_img.mode == "RGB"
    # Transparent pixel composited onto white
    assert pil_img.getpixel((1000, 500)) == (255, 255, 255)

    c_hash = sha256_bytes(src.read_bytes())
    ref_name = ref_filename_for_hash(c_hash)
    thumb_name = thumb_filename_for_key(c_hash)

    ref_path, size_bytes = save_managed_ref(pil_img, tmp_path / "refs", ref_name)
    assert ref_path.exists()
    assert size_bytes > 0
    with Image.open(ref_path) as saved_jpg:
        assert saved_jpg.format == "JPEG"
        assert saved_jpg.size == (1920, 960)

    thumb_path = save_thumbnail(pil_img, tmp_path / "thumbs", thumb_name, max_size=480)
    assert thumb_path.exists()
    with Image.open(thumb_path) as t_img:
        assert max(t_img.size) == 480


def test_dhash_invariant_to_resize_and_jpeg_recompression(tmp_path: Path):
    # Create an image with spatial gradients/shapes
    arr = np.zeros((400, 400, 3), dtype=np.uint8)
    for y in range(400):
        arr[y, :, 0] = int((y / 400) * 255)
    for x in range(400):
        arr[:, x, 1] = int((x / 400) * 255)
    arr[50:200, 50:250, 2] = 220

    img_hi = Image.fromarray(arr, mode="RGB")
    img_lo = img_hi.resize((200, 200), Image.Resampling.BILINEAR)
    jpg_path = tmp_path / "recompressed.jpg"
    img_lo.save(jpg_path, format="JPEG", quality=60)
    with Image.open(jpg_path) as reloaded:
        h_hi = compute_dhash(img_hi)
        h_lo = compute_dhash(reloaded)

    assert len(h_hi) == 16
    assert hamming_distance_hex(h_hi, h_lo) <= 2


def test_db_folder_unlink_keeps_refs_and_delete_removes_files(tmp_path: Path):
    db = Database(tmp_path / "test.db")
    assert db.get_image_max_edge(1920) == 1920
    assert db.set_image_max_edge(1280) == 1280
    assert db.get_image_max_edge(1920) == 1280

    folder_id = db.upsert_folder(str(tmp_path))
    emb = np.ones(768, dtype=np.float32).tobytes()
    db.insert_images_batch(
        [
            {
                "folder_id": folder_id,
                "path": str(tmp_path / "a.png"),
                "filename": "a.png",
                "mtime": 100.0,
                "size_bytes": 1234,
                "width": 1000,
                "height": 800,
                "ref_name": "aaa.jpg",
                "thumb_name": "aaa.webp",
                "content_hash": "a" * 64,
                "dhash": "0123456789abcdef",
                "source_type": "folder",
                "embedding": emb,
                "poses_json": json.dumps({"heads": [], "torsos": [], "subjects": []}),
                "indexed_at": time.time(),
            }
        ]
    )

    # Unlinking folder keeps image safely in DB (folder_id -> None)
    refs_rm, thumbs_rm = db.delete_folder(folder_id, delete_images=False)
    assert refs_rm == [] and thumbs_rm == []
    assert db.get_stats() == (1, 0)

    # Deleting image permanently removes DB row and returns stored filenames
    rows = db.load_all_for_index()
    img_id = rows[0]["id"]
    ref_names, thumb_names = db.delete_images_by_ids([img_id])
    assert ref_names == ["aaa.jpg"]
    assert thumb_names == ["aaa.webp"]
    assert db.get_stats() == (0, 0)

    refs_dir = tmp_path / "refs"
    thumbs_dir = tmp_path / "thumbs"
    refs_dir.mkdir()
    thumbs_dir.mkdir()
    (refs_dir / "aaa.jpg").write_bytes(b"jpg")
    (thumbs_dir / "aaa.webp").write_bytes(b"webp")
    assert remove_stored_files(refs_dir, thumbs_dir, ref_names, thumb_names) == (1, 1)
    assert not (refs_dir / "aaa.jpg").exists()
    assert not (thumbs_dir / "aaa.webp").exists()
