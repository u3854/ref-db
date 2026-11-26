"""Tests for custom tagging, batch modification, and tag search filtering."""

import json
import time
from pathlib import Path

import numpy as np

from backend.db import Database
from backend.schemas import SearchRequest
from backend.search_index import SearchIndex


def test_tags_crud_batch_and_search(tmp_path: Path):
    db = Database(tmp_path / "tags.db")
    fid = db.upsert_folder(str(tmp_path))
    emb = np.array([1.0, 0.0], dtype=np.float32).tobytes()
    poses = json.dumps({"heads": [], "torsos": [], "subjects": []})

    db.upsert_images_batch(
        [
            {
                "folder_id": fid,
                "path": str(tmp_path / "char1.png"),
                "filename": "char1.png",
                "mtime": 1.0,
                "size_bytes": 10,
                "width": 500,
                "height": 500,
                "thumb_name": "c1.webp",
                "embedding": emb,
                "poses_json": poses,
                "indexed_at": time.time(),
            },
            {
                "folder_id": fid,
                "path": str(tmp_path / "char2.png"),
                "filename": "char2.png",
                "mtime": 1.0,
                "size_bytes": 10,
                "width": 500,
                "height": 500,
                "thumb_name": "c2.webp",
                "embedding": emb,
                "poses_json": poses,
                "indexed_at": time.time(),
            },
        ]
    )

    rows = db.load_all_for_index()
    id1, id2 = rows[0]["id"], rows[1]["id"]

    # Set individual tags (case-insensitive deduplication)
    t1 = db.set_image_tags(id1, ["Character A", "character a", "Cloak"])
    assert [t["name"] for t in t1] == ["Character A", "Cloak"]

    # Batch add + remove
    db.batch_modify_tags([id1, id2], add_tags=["Rainy Mood"], remove_tags=["cloak"])
    tags = {t["name"]: t["id"] for t in db.list_tags()}
    assert "Rainy Mood" in tags
    assert "Character A" in tags

    idx = SearchIndex(db)
    # Match ALL: Character A + Rainy Mood -> only id1
    res_all = idx.search(
        SearchRequest(tag_ids=[tags["Character A"], tags["Rainy Mood"]], tag_mode="all"),
        text_embedding=None,
    )
    assert [m.id for m in res_all.matches] == [id1]

    # Match ANY: Character A | Rainy Mood -> both id1 and id2
    res_any = idx.search(
        SearchRequest(tag_ids=[tags["Character A"], tags["Rainy Mood"]], tag_mode="any"),
        text_embedding=None,
    )
    assert {m.id for m in res_any.matches} == {id1, id2}

    # Delete tag removes associations
    assert db.delete_tag(tags["Character A"]) is True
    assert db.get_image_by_id(id1)["tags"][0]["name"] == "Rainy Mood"
