"""Tests for vectorized semantic search, circular angles, and paired vs independent poses."""

import json
import time
from pathlib import Path

import numpy as np

from backend.db import Database
from backend.schemas import SearchRequest
from backend.search_index import SearchIndex, angular_diff


def _unit(vec: list[float]) -> np.ndarray:
    arr = np.array(vec, dtype=np.float32)
    return arr / np.linalg.norm(arr)


def test_angular_diff_wraparound():
    assert angular_diff(175.0, -175.0) == 10.0
    assert angular_diff(-180.0, 180.0) == 0.0
    assert angular_diff(-45.0, 45.0) == 90.0


def test_search_semantic_and_paired_vs_independent(tmp_path: Path):
    db = Database(tmp_path / "search.db")
    fid = db.upsert_folder(str(tmp_path))

    # Multi-person image: Person 1 has head=-40, torso=0; Person 2 has head=+40, torso=175
    poses_multi = {
        "heads": [
            {"yaw": -40.0, "pitch": 0.0, "roll": 0.0, "cx": 0.25, "cy": 0.2, "size": 0.1},
            {"yaw": 40.0, "pitch": 0.0, "roll": 0.0, "cx": 0.75, "cy": 0.2, "size": 0.1},
        ],
        "torsos": [
            {"yaw": 0.0, "lean": 0.0, "cx": 0.25, "cy": 0.4, "span": 0.2},
            {"yaw": 175.0, "lean": 0.0, "cx": 0.75, "cy": 0.4, "span": 0.2},
        ],
        "subjects": [
            {
                "head": {"yaw": -40.0, "pitch": 0.0, "roll": 0.0, "cx": 0.25, "cy": 0.2, "size": 0.1},
                "torso": {"yaw": 0.0, "lean": 0.0, "cx": 0.25, "cy": 0.4, "span": 0.2},
            },
            {
                "head": {"yaw": 40.0, "pitch": 0.0, "roll": 0.0, "cx": 0.75, "cy": 0.2, "size": 0.1},
                "torso": {"yaw": 175.0, "lean": 0.0, "cx": 0.75, "cy": 0.4, "span": 0.2},
            },
        ],
    }

    poses_single_back = {
        "heads": [],
        "torsos": [{"yaw": -175.0, "lean": 0.0, "cx": 0.5, "cy": 0.4, "span": 0.2}],
        "subjects": [
            {"head": None, "torso": {"yaw": -175.0, "lean": 0.0, "cx": 0.5, "cy": 0.4, "span": 0.2}}
        ],
    }

    db.upsert_images_batch(
        [
            {
                "folder_id": fid,
                "path": str(tmp_path / "multi.png"),
                "filename": "multi.png",
                "mtime": 1.0,
                "size_bytes": 100,
                "width": 1000,
                "height": 1000,
                "thumb_name": "m.webp",
                "embedding": _unit([1.0, 0.0, 0.0]).tobytes(),
                "poses_json": json.dumps(poses_multi),
                "indexed_at": time.time(),
            },
            {
                "folder_id": fid,
                "path": str(tmp_path / "back.png"),
                "filename": "back.png",
                "mtime": 1.0,
                "size_bytes": 100,
                "width": 1000,
                "height": 1000,
                "thumb_name": "b.webp",
                "embedding": _unit([0.2, 0.9, 0.0]).tobytes(),
                "poses_json": json.dumps(poses_single_back),
                "indexed_at": time.time(),
            },
        ]
    )

    idx = SearchIndex(db)
    assert idx.count == 2

    # Semantic search favors multi.png
    res = idx.search(SearchRequest(query="trench coat"), text_embedding=_unit([1.0, 0.0, 0.0]))
    assert res.total_matches == 2
    assert res.matches[0].filename == "multi.png"

    # Cross-person query: head=+40 AND torso=0 should fail in paired mode, pass in independent mode
    paired_req = SearchRequest(
        use_head_yaw=True,
        head_yaw=40.0,
        head_tol=15.0,
        use_torso_yaw=True,
        torso_yaw=0.0,
        torso_tol=15.0,
        match_mode="paired",
    )
    assert idx.search(paired_req, text_embedding=None).total_matches == 0

    indep_req = paired_req.model_copy(update={"match_mode": "independent"})
    assert idx.search(indep_req, text_embedding=None).total_matches == 1

    # Circular torso back view (+180) matches both +175 and -175 within 10 deg
    back_req = SearchRequest(use_torso_yaw=True, torso_yaw=180.0, torso_tol=10.0)
    back_res = idx.search(back_req, text_embedding=None)
    assert back_res.total_matches == 2
