# ref-db

Local semantic + 3D head/torso pose art reference search app powered by **SigLIP**, **MediaPipe Tasks**, **FastAPI**, **SQLite**, and **React**.

## Features

- **Semantic Search (SigLIP)**: Search references by clothing, lighting, props, environment, or mood (`google/siglip-base-patch16-224`, `float16` on CUDA ~900 MB VRAM, with `mps`/`cpu` fallback).
- **3D Head & Torso Pose Filtering**: Interactive head orientation gimbal (yaw/pitch), 360° torso compass (yaw/lean), quick pose presets, and spatial subject pairing so multi-person images match head + torso on the same subject.
- **Project-Local Model Caching**: Hugging Face SigLIP weights and MediaPipe `.task` files are cached under `./.models/` (git-ignored) for offline use after initial download.
- **Reduce-Only Resize Config**: Configurable `image_max_edge` (default `1920` px) scales down larger images while keeping aspect ratio during processing and lightbox serving without modifying original files on disk.
- **Artist Workflow**: Fast WebP thumbnail grid, live SSE incremental folder indexing (skips unchanged timestamps, prunes deleted files), and a lightbox inspector with one-click **Copy Image** (PNG clipboard paste into Clip Studio Paint) and **Copy Path**.

## Setup & Run

Requirements: Python `3.12` (via `uv`) and Node.js `20+`.

```powershell
# 1. Install Python 3.12 + CUDA PyTorch + backend dependencies
uv sync

# 2. Build the React frontend
cd frontend
npm install
npm run build
cd ..

# 3. Launch the app (opens http://127.0.0.1:8000)
uv run python main.py
```

## Configuration

Settings can be overridden via environment variables prefixed with `REF_DB_` (or adjusted at runtime in **Folders & Settings**):

- `REF_DB_IMAGE_MAX_EDGE` (default `1920`, `0` = serve/process original dimensions)
- `REF_DB_THUMB_MAX_SIZE` (default `480`)
- `REF_DB_EMBED_BATCH_SIZE` (default `16`)
- `REF_DB_PORT` (default `8000`)

## Tests

```powershell
uv run pytest tests/ -v
```
