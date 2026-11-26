"""Image hashing, resizing, uniform JPEG storage, and WebP thumbnail helpers."""

from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


def sha256_bytes(data: bytes) -> str:
    """Return hex SHA-256 digest of raw image bytes."""
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """Stream-compute hex SHA-256 digest of a file on disk."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def thumb_filename_for_key(key: str) -> str:
    """Return deterministic WebP thumbnail filename for a content hash or path key."""
    if len(key) == 64 and all(c in "0123456789abcdef" for c in key):
        return f"{key}.webp"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return f"{digest}.webp"


def ref_filename_for_hash(content_hash: str) -> str:
    """Return uniform managed JPEG filename for a SHA-256 content hash."""
    return f"{content_hash}.jpg"


# Backwards-compatible alias
thumb_filename_for_path = thumb_filename_for_key


def flatten_to_rgb(
    img: Image.Image,
    bg_color: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """
    Convert an image to RGB, compositing any alpha/transparency channel onto
    a solid background color (white by default for uniform JPEG output).
    """
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, bg_color)
        bg.paste(rgba, mask=rgba.split()[3])
        return bg
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def resize_reduce_only(img: Image.Image, max_edge: int) -> Image.Image:
    """
    Resize an image so its longest side is at most `max_edge` pixels while
    preserving aspect ratio. Never upscales smaller images.
    """
    if max_edge <= 0:
        return img
    width, height = img.size
    longest = max(width, height)
    if longest <= max_edge:
        return img
    scale = max_edge / float(longest)
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def compute_dhash(pil_img: Image.Image) -> str:
    """
    Compute a 64-bit perceptual difference hash (dHash) returned as a 16-char hex string.
    Invariant to image resolution, JPEG recompression, and format changes.
    """
    gray = pil_img.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    raw_pixels = (
        gray.get_flattened_data()
        if hasattr(gray, "get_flattened_data")
        else gray.getdata()
    )
    pixels = list(raw_pixels)
    bits = 0
    for row in range(8):
        offset = row * 9
        for col in range(8):
            bits = (bits << 1) | (1 if pixels[offset + col] > pixels[offset + col + 1] else 0)
    return f"{bits:016x}"


def hamming_distance_hex(a: str, b: str) -> int:
    """Compute Hamming distance between two 16-char hex dHash strings."""
    return (int(a, 16) ^ int(b, 16)).bit_count()


def open_rgb_exif(
    source: Path | bytes,
    max_edge: int = 0,
    bg_color: tuple[int, int, int] = (255, 255, 255),
) -> tuple[Image.Image, int, int]:
    """
    Open an image from a file path or raw bytes, apply EXIF orientation,
    flatten transparency onto `bg_color`, and apply reduce-only longest-side resize.

    Returns (pil_rgb_image, stored_width, stored_height).
    """
    stream = BytesIO(source) if isinstance(source, (bytes, bytearray)) else source
    with Image.open(stream) as raw_img:
        oriented = ImageOps.exif_transpose(raw_img)
        rgb = flatten_to_rgb(oriented, bg_color=bg_color)
        resized = resize_reduce_only(rgb, max_edge)
        final_img = rgb.copy() if resized is rgb else resized
        w, h = final_img.size
        return final_img, w, h


def save_managed_ref(
    pil_img: Image.Image,
    refs_dir: Path,
    ref_name: str,
    quality: int = 92,
) -> tuple[Path, int]:
    """Persist a uniform RGB JPEG copy into `refs_dir`, returning (path, size_bytes)."""
    refs_dir.mkdir(parents=True, exist_ok=True)
    out_path = refs_dir / ref_name
    flatten_to_rgb(pil_img).save(
        out_path,
        format="JPEG",
        quality=quality,
        optimize=True,
    )
    return out_path, out_path.stat().st_size


def save_thumbnail(
    pil_img: Image.Image,
    thumbs_dir: Path,
    thumb_name: str,
    max_size: int = 480,
    quality: int = 82,
) -> Path:
    """Generate and persist a reduce-only WebP thumbnail."""
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_img = resize_reduce_only(pil_img, max_size)
    out_path = thumbs_dir / thumb_name
    thumb_img.save(out_path, format="WEBP", quality=quality, method=4)
    return out_path


def remove_thumbnails(thumbs_dir: Path, thumb_names: list[str]) -> int:
    """Delete thumbnail files from disk, returning count removed."""
    removed = 0
    for name in thumb_names:
        if not name:
            continue
        p = thumbs_dir / name
        if p.exists() and p.is_file():
            try:
                p.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def remove_stored_files(
    refs_dir: Path,
    thumbs_dir: Path,
    ref_names: list[str],
    thumb_names: list[str],
) -> tuple[int, int]:
    """Delete stored managed JPEG refs and WebP thumbnails, returning (refs_removed, thumbs_removed)."""
    refs_removed = remove_thumbnails(refs_dir, ref_names)
    thumbs_removed = remove_thumbnails(thumbs_dir, thumb_names)
    return refs_removed, thumbs_removed
