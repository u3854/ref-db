"""3D head and torso pose extraction via MediaPipe Tasks with spatial subject pairing."""

from __future__ import annotations

import math
import urllib.request
from pathlib import Path
from typing import Iterable

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from PIL import Image

from backend.config import Settings, settings
from backend.thumbnails import resize_reduce_only


def rotation_matrix_to_euler(R: np.ndarray) -> tuple[float, float, float]:
    """Convert a 3x3 rotation matrix to (pitch, yaw, roll) in degrees."""
    sy = math.sqrt(R[0, 0] ** 2 + R[1, 0] ** 2)
    singular = sy < 1e-6
    if not singular:
        pitch = math.atan2(R[2, 1], R[2, 2])
        yaw = math.atan2(-R[2, 0], sy)
        roll = math.atan2(R[1, 0], R[0, 0])
    else:
        pitch = math.atan2(-R[1, 2], R[1, 1])
        yaw = math.atan2(-R[2, 0], sy)
        roll = 0.0
    return (
        math.degrees(pitch),
        math.degrees(yaw),
        math.degrees(roll),
    )


def ensure_mediapipe_models(cfg: Settings = settings) -> tuple[Path, Path]:
    """Ensure MediaPipe .task models are cached inside the project .models directory."""
    cfg.ensure_dirs_and_env()
    face_path = cfg.mediapipe_dir / "face_landmarker.task"
    pose_path = cfg.mediapipe_dir / "pose_landmarker_full.task"

    if not face_path.exists():
        urllib.request.urlretrieve(cfg.face_task_url, face_path)
    if not pose_path.exists():
        urllib.request.urlretrieve(cfg.pose_task_url, pose_path)

    return face_path, pose_path


def _bbox_from_landmarks(landmarks: Iterable) -> tuple[float, float, float]:
    """Return (cx, cy, size) in normalized [0, 1] image coordinates."""
    xs = [float(lm.x) for lm in landmarks]
    ys = [float(lm.y) for lm in landmarks]
    if not xs:
        return 0.5, 0.5, 0.0
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cx = 0.5 * (min_x + max_x)
    cy = 0.5 * (min_y + max_y)
    size = max(max_x - min_x, max_y - min_y, 1e-4)
    return round(cx, 4), round(cy, 4), round(size, 4)


def pair_heads_and_torsos(heads: list[dict], torsos: list[dict]) -> list[dict]:
    """
    Spatially pair each detected head to its closest torso in 2D image space
    using upper-body geometry (head center near torso neck/shoulder anchor).
    Returns list of {"head": dict | None, "torso": dict | None}.
    """
    if not heads and not torsos:
        return []
    if not heads:
        return [{"head": None, "torso": t} for t in torsos]
    if not torsos:
        return [{"head": h, "torso": None} for h in heads]

    pairs: list[tuple[float, int, int]] = []
    for hi, head in enumerate(heads):
        hx, hy = head.get("cx", 0.5), head.get("cy", 0.5)
        for ti, torso in enumerate(torsos):
            tx, ty = torso.get("cx", 0.5), torso.get("cy", 0.5)
            span = max(torso.get("span", 0.2), head.get("size", 0.1), 0.12)
            # Head sits slightly above shoulder midpoint, so allow generous vertical offset
            dx = (hx - tx) / span
            dy = (hy - (ty - 0.35 * span)) / (1.5 * span)
            dist = math.hypot(dx, dy)
            if dist <= 1.8:
                pairs.append((dist, hi, ti))

    pairs.sort(key=lambda item: item[0])
    used_heads: set[int] = set()
    used_torsos: set[int] = set()
    subjects: list[dict] = []

    for _, hi, ti in pairs:
        if hi in used_heads or ti in used_torsos:
            continue
        used_heads.add(hi)
        used_torsos.add(ti)
        subjects.append({"head": heads[hi], "torso": torsos[ti]})

    for hi, h in enumerate(heads):
        if hi not in used_heads:
            subjects.append({"head": h, "torso": None})
    for ti, t in enumerate(torsos):
        if ti not in used_torsos:
            subjects.append({"head": None, "torso": t})

    return subjects


def extract_poses_from_rgb(
    rgb_array: np.ndarray,
    face_detector,
    pose_detector,
) -> dict:
    """
    Extract head angles, torso angles, and spatially paired subjects from an RGB numpy image.

    Conventions:
      - head.yaw:   -90 (viewer's left) to +90 (viewer's right)
      - head.pitch: -60 (down) to +60 (up)
      - head.roll:  -90 to +90
      - torso.yaw:  -180..+180 (0 = front, -45 = 3/4 left, +45 = 3/4 right, +-180 = back)
      - torso.lean: -60 (forward) to +60 (backward)
    """
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_array)
    heads: list[dict] = []
    torsos: list[dict] = []

    face_res = face_detector.detect(mp_image)
    if face_res.facial_transformation_matrixes:
        face_lms_list = getattr(face_res, "face_landmarks", []) or []
        for idx, mat in enumerate(face_res.facial_transformation_matrixes):
            R = np.array(mat, dtype=np.float64).reshape(4, 4)[:3, :3]
            pitch, yaw, roll = rotation_matrix_to_euler(R)
            cx, cy, size = (
                _bbox_from_landmarks(face_lms_list[idx])
                if idx < len(face_lms_list)
                else (0.5, 0.5, 0.2)
            )
            heads.append(
                {
                    "yaw": round(float(np.clip(-yaw, -90.0, 90.0)), 1),
                    "pitch": round(float(np.clip(pitch, -60.0, 60.0)), 1),
                    "roll": round(float(np.clip(roll, -90.0, 90.0)), 1),
                    "cx": cx,
                    "cy": cy,
                    "size": size,
                }
            )

    pose_res = pose_detector.detect(mp_image)
    if pose_res.pose_world_landmarks:
        norm_lms_list = getattr(pose_res, "pose_landmarks", []) or []
        for idx, w_lms in enumerate(pose_res.pose_world_landmarks):
            l_sh, r_sh = w_lms[11], w_lms[12]
            l_hip, r_hip = w_lms[23], w_lms[24]

            dx = l_sh.x - r_sh.x
            dz = l_sh.z - r_sh.z
            torso_yaw = math.degrees(math.atan2(dz, dx))

            mid_sh_y = 0.5 * (l_sh.y + r_sh.y)
            mid_sh_z = 0.5 * (l_sh.z + r_sh.z)
            mid_hip_y = 0.5 * (l_hip.y + r_hip.y)
            mid_hip_z = 0.5 * (l_hip.z + r_hip.z)

            dy_up = mid_hip_y - mid_sh_y
            dz_back = mid_sh_z - mid_hip_z
            torso_lean = math.degrees(math.atan2(dz_back, max(abs(dy_up), 1e-4)))

            if idx < len(norm_lms_list):
                n_lms = norm_lms_list[idx]
                nl_sh, nr_sh = n_lms[11], n_lms[12]
                cx = round(0.5 * (float(nl_sh.x) + float(nr_sh.x)), 4)
                cy = round(0.5 * (float(nl_sh.y) + float(nr_sh.y)), 4)
                span = round(
                    max(math.hypot(float(nl_sh.x - nr_sh.x), float(nl_sh.y - nr_sh.y)), 0.05),
                    4,
                )
            else:
                cx, cy, span = 0.5, 0.5, 0.2

            torsos.append(
                {
                    "yaw": round(float(torso_yaw), 1),
                    "lean": round(float(np.clip(torso_lean, -60.0, 60.0)), 1),
                    "cx": cx,
                    "cy": cy,
                    "span": span,
                }
            )

    subjects = pair_heads_and_torsos(heads, torsos)
    return {"heads": heads, "torsos": torsos, "subjects": subjects}


class PoseExtractor:
    """Context-managed MediaPipe Face + Pose extractor."""

    def __init__(self, cfg: Settings = settings) -> None:
        self.cfg = cfg
        self._face_det = None
        self._pose_det = None

    def __enter__(self) -> "PoseExtractor":
        face_path, pose_path = ensure_mediapipe_models(self.cfg)
        face_options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(face_path)),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=4,
            min_face_detection_confidence=0.45,
            output_facial_transformation_matrixes=True,
        )
        pose_options = mp_vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(pose_path)),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_poses=4,
            min_pose_detection_confidence=0.45,
        )
        self._face_det = mp_vision.FaceLandmarker.create_from_options(face_options)
        self._pose_det = mp_vision.PoseLandmarker.create_from_options(pose_options)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._face_det is not None:
            self._face_det.close()
            self._face_det = None
        if self._pose_det is not None:
            self._pose_det.close()
            self._pose_det = None

    def extract(self, pil_img: Image.Image) -> dict:
        if self._face_det is None or self._pose_det is None:
            raise RuntimeError("PoseExtractor must be used inside a 'with' block.")
        mp_img = resize_reduce_only(pil_img, self.cfg.pose_max_edge)
        return extract_poses_from_rgb(np.array(mp_img), self._face_det, self._pose_det)
