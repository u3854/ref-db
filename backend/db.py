"""SQLite persistence layer with WAL mode for self-contained refs, folders, and tags."""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class Database:
    """Thread-safe SQLite wrapper using short-lived WAL connections."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA foreign_keys=ON;")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS folders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT UNIQUE NOT NULL,
                    last_indexed_at REAL,
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                    path TEXT NOT NULL DEFAULT '',
                    filename TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    ref_name TEXT NOT NULL DEFAULT '',
                    thumb_name TEXT NOT NULL,
                    content_hash TEXT UNIQUE,
                    dhash TEXT NOT NULL DEFAULT '',
                    source_type TEXT NOT NULL DEFAULT 'folder',
                    embedding BLOB NOT NULL,
                    poses_json TEXT NOT NULL,
                    indexed_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    color TEXT NOT NULL DEFAULT '#5b8cff',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS image_tags (
                    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (image_id, tag_id)
                );

                CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
                """
            )
            self._migrate_images_if_needed(conn)
            conn.executescript(
                """
                DROP INDEX IF EXISTS idx_images_content_hash;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_images_content_hash ON images(content_hash);
                CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder_id);
                CREATE INDEX IF NOT EXISTS idx_images_dhash ON images(dhash);
                """
            )

    @staticmethod
    def _migrate_images_if_needed(conn: sqlite3.Connection) -> None:
        """Upgrade older v1 images table schema to self-contained ref storage."""
        cols = {
            r["name"]
            for r in conn.execute("PRAGMA table_info(images)").fetchall()
        }
        if "ref_name" in cols and "content_hash" in cols and "dhash" in cols:
            return

        conn.executescript(
            """
            PRAGMA foreign_keys=OFF;
            CREATE TABLE images_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                path TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL,
                mtime REAL NOT NULL,
                size_bytes INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                ref_name TEXT NOT NULL DEFAULT '',
                thumb_name TEXT NOT NULL,
                content_hash TEXT UNIQUE,
                dhash TEXT NOT NULL DEFAULT '',
                source_type TEXT NOT NULL DEFAULT 'folder',
                embedding BLOB NOT NULL,
                poses_json TEXT NOT NULL,
                indexed_at REAL NOT NULL
            );
            INSERT INTO images_new (
                id, folder_id, path, filename, mtime, size_bytes,
                width, height, ref_name, thumb_name, content_hash, dhash,
                source_type, embedding, poses_json, indexed_at
            )
            SELECT
                id, folder_id, path, filename, mtime, size_bytes,
                width, height, '', thumb_name, NULL, '',
                'folder', embedding, poses_json, indexed_at
            FROM images;
            DROP TABLE images;
            ALTER TABLE images_new RENAME TO images;
            CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder_id);
            CREATE INDEX IF NOT EXISTS idx_images_dhash ON images(dhash);
            PRAGMA foreign_keys=ON;
            """
        )

    # ------------------------------------------------------------------
    # App settings helpers
    # ------------------------------------------------------------------
    def get_setting(self, key: str, default: str | None = None) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT value FROM app_settings WHERE key = ?",
                (key,),
            ).fetchone()
        return row["value"] if row is not None else default

    def set_setting(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def get_image_max_edge(self, default_edge: int) -> int:
        raw = self.get_setting("image_max_edge")
        if raw is None:
            return default_edge
        try:
            return max(0, int(raw))
        except ValueError:
            return default_edge

    def set_image_max_edge(self, max_edge: int) -> int:
        clamped = max(0, int(max_edge))
        self.set_setting("image_max_edge", str(clamped))
        return clamped

    # ------------------------------------------------------------------
    # Folder CRUD
    # ------------------------------------------------------------------
    def upsert_folder(self, folder_path: str) -> int:
        now = time.time()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO folders (path, created_at) VALUES (?, ?)
                ON CONFLICT(path) DO NOTHING
                """,
                (folder_path, now),
            )
            row = conn.execute(
                "SELECT id FROM folders WHERE path = ?",
                (folder_path,),
            ).fetchone()
            assert row is not None
            return int(row["id"])

    def mark_folder_indexed(self, folder_id: int) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE folders SET last_indexed_at = ? WHERE id = ?",
                (time.time(), folder_id),
            )

    def list_folders(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    f.id,
                    f.path,
                    f.last_indexed_at,
                    f.created_at,
                    COUNT(i.id) AS image_count
                FROM folders f
                LEFT JOIN images i ON i.folder_id = f.id
                GROUP BY f.id
                ORDER BY f.created_at DESC
                """
            ).fetchall()
        return [dict(r) for r in rows]

    def get_folder(self, folder_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id, path, last_indexed_at, created_at FROM folders WHERE id = ?",
                (folder_id,),
            ).fetchone()
        return dict(row) if row is not None else None

    def delete_folder(
        self,
        folder_id: int,
        delete_images: bool = False,
    ) -> tuple[list[str], list[str]]:
        """
        Remove a saved folder entry. When `delete_images=False` (default),
        imported images remain safely in managed storage (`folder_id = NULL`).
        When `delete_images=True`, deletes its images and returns (ref_names, thumb_names).
        """
        with self.connect() as conn:
            if not delete_images:
                conn.execute(
                    "UPDATE images SET folder_id = NULL WHERE folder_id = ?",
                    (folder_id,),
                )
                conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
                return [], []

            rows = conn.execute(
                "SELECT ref_name, thumb_name FROM images WHERE folder_id = ?",
                (folder_id,),
            ).fetchall()
            ref_names = [r["ref_name"] for r in rows if r["ref_name"]]
            thumb_names = [r["thumb_name"] for r in rows if r["thumb_name"]]
            conn.execute("DELETE FROM images WHERE folder_id = ?", (folder_id,))
            conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        return ref_names, thumb_names

    # ------------------------------------------------------------------
    # Image CRUD & Deduplication
    # ------------------------------------------------------------------
    def get_existing_hashes(self) -> dict[str, tuple[str, str]]:
        """Return {content_hash: (ref_name, thumb_name)} for all stored images."""
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT content_hash, ref_name, thumb_name
                FROM images
                WHERE content_hash IS NOT NULL
                """
            ).fetchall()
        return {
            r["content_hash"]: (r["ref_name"], r["thumb_name"])
            for r in rows
        }

    def insert_images_batch(self, records: list[dict]) -> list[int]:
        if not records:
            return []
        inserted_ids: list[int] = []
        with self.connect() as conn:
            for raw_rec in records:
                rec = {
                    "ref_name": "",
                    "content_hash": None,
                    "dhash": "",
                    "source_type": "folder",
                    **raw_rec,
                }
                cur = conn.execute(
                    """
                    INSERT INTO images (
                        folder_id, path, filename, mtime, size_bytes,
                        width, height, ref_name, thumb_name, content_hash,
                        dhash, source_type, embedding, poses_json, indexed_at
                    ) VALUES (
                        :folder_id, :path, :filename, :mtime, :size_bytes,
                        :width, :height, :ref_name, :thumb_name, :content_hash,
                        :dhash, :source_type, :embedding, :poses_json, :indexed_at
                    )
                    ON CONFLICT(content_hash) DO UPDATE SET
                        folder_id = COALESCE(images.folder_id, excluded.folder_id),
                        mtime = excluded.mtime,
                        size_bytes = excluded.size_bytes,
                        width = excluded.width,
                        height = excluded.height,
                        ref_name = excluded.ref_name,
                        thumb_name = excluded.thumb_name,
                        dhash = excluded.dhash,
                        embedding = excluded.embedding,
                        poses_json = excluded.poses_json,
                        indexed_at = excluded.indexed_at
                    """,
                    rec,
                )
                if cur.lastrowid:
                    inserted_ids.append(int(cur.lastrowid))
        return inserted_ids

    # Keep backwards-compatible alias
    upsert_images_batch = insert_images_batch

    def delete_images_by_ids(self, image_ids: list[int]) -> tuple[list[str], list[str]]:
        if not image_ids:
            return [], []
        placeholders = ",".join("?" for _ in image_ids)
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT ref_name, thumb_name FROM images WHERE id IN ({placeholders})",
                image_ids,
            ).fetchall()
            ref_names = [r["ref_name"] for r in rows if r["ref_name"]]
            thumb_names = [r["thumb_name"] for r in rows if r["thumb_name"]]
            conn.execute(
                f"DELETE FROM images WHERE id IN ({placeholders})",
                image_ids,
            )
        return ref_names, thumb_names

    def load_all_for_index(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, folder_id, path, filename, width, height,
                       ref_name, thumb_name, content_hash, dhash, source_type,
                       embedding, poses_json
                FROM images
                ORDER BY id ASC
                """
            ).fetchall()
            tag_rows = conn.execute(
                """
                SELECT it.image_id, t.id, t.name, t.color
                FROM image_tags it
                JOIN tags t ON t.id = it.tag_id
                ORDER BY t.name COLLATE NOCASE ASC
                """
            ).fetchall()

        tags_by_image: dict[int, list[dict]] = {}
        for tr in tag_rows:
            tags_by_image.setdefault(int(tr["image_id"]), []).append(
                {"id": int(tr["id"]), "name": tr["name"], "color": tr["color"]}
            )

        results = []
        for r in rows:
            img_id = int(r["id"])
            results.append(
                {
                    "id": img_id,
                    "folder_id": int(r["folder_id"]) if r["folder_id"] is not None else None,
                    "path": r["path"],
                    "filename": r["filename"],
                    "width": int(r["width"]),
                    "height": int(r["height"]),
                    "ref_name": r["ref_name"],
                    "thumb_name": r["thumb_name"],
                    "content_hash": r["content_hash"],
                    "dhash": r["dhash"],
                    "source_type": r["source_type"],
                    "embedding": r["embedding"],
                    "poses": json.loads(r["poses_json"]),
                    "tags": tags_by_image.get(img_id, []),
                }
            )
        return results

    def get_image_by_id(self, image_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT id, folder_id, path, filename, mtime, size_bytes,
                       width, height, ref_name, thumb_name, content_hash,
                       dhash, source_type, poses_json, indexed_at
                FROM images
                WHERE id = ?
                """,
                (image_id,),
            ).fetchone()
            if row is None:
                return None
            tag_rows = conn.execute(
                """
                SELECT t.id, t.name, t.color
                FROM image_tags it
                JOIN tags t ON t.id = it.tag_id
                WHERE it.image_id = ?
                ORDER BY t.name COLLATE NOCASE ASC
                """,
                (image_id,),
            ).fetchall()
        data = dict(row)
        data["poses"] = json.loads(data.pop("poses_json"))
        data["tags"] = [
            {"id": int(tr["id"]), "name": tr["name"], "color": tr["color"]}
            for tr in tag_rows
        ]
        return data

    def get_stats(self) -> tuple[int, int]:
        with self.connect() as conn:
            img_count = conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]
            folder_count = conn.execute("SELECT COUNT(*) FROM folders").fetchone()[0]
        return int(img_count), int(folder_count)

    # ------------------------------------------------------------------
    # Tag CRUD
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_tag_names(names: list[str]) -> list[str]:
        seen: set[str] = set()
        cleaned: list[str] = []
        for raw in names:
            name = " ".join(raw.strip().split())
            if not name:
                continue
            key = name.casefold()
            if key not in seen:
                seen.add(key)
                cleaned.append(name)
        return cleaned

    def _ensure_tags(self, conn: sqlite3.Connection, names: list[str]) -> list[dict]:
        normalized = self._normalize_tag_names(names)
        if not normalized:
            return []
        now = time.time()
        palette = [
            "#5b8cff",
            "#34d399",
            "#f59e0b",
            "#ec4899",
            "#a78bfa",
            "#22d3ee",
            "#fb7185",
        ]
        tags: list[dict] = []
        for name in normalized:
            existing = conn.execute(
                "SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE",
                (name,),
            ).fetchone()
            if existing is None:
                color = palette[abs(hash(name.casefold())) % len(palette)]
                conn.execute(
                    "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
                    (name, color, now),
                )
                existing = conn.execute(
                    "SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE",
                    (name,),
                ).fetchone()
            assert existing is not None
            tags.append(
                {"id": int(existing["id"]), "name": existing["name"], "color": existing["color"]}
            )
        return tags

    def list_tags(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT t.id, t.name, t.color, COUNT(it.image_id) AS image_count
                FROM tags t
                LEFT JOIN image_tags it ON it.tag_id = t.id
                GROUP BY t.id
                ORDER BY image_count DESC, t.name COLLATE NOCASE ASC
                """
            ).fetchall()
        return [
            {
                "id": int(r["id"]),
                "name": r["name"],
                "color": r["color"],
                "image_count": int(r["image_count"]),
            }
            for r in rows
        ]

    def set_image_tags(self, image_id: int, tag_names: list[str]) -> list[dict]:
        with self.connect() as conn:
            exists = conn.execute("SELECT 1 FROM images WHERE id = ?", (image_id,)).fetchone()
            if exists is None:
                raise KeyError(f"Image {image_id} not found")
            ensured = self._ensure_tags(conn, tag_names)
            conn.execute("DELETE FROM image_tags WHERE image_id = ?", (image_id,))
            if ensured:
                conn.executemany(
                    "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)",
                    [(image_id, t["id"]) for t in ensured],
                )
        return ensured

    def batch_modify_tags(
        self,
        image_ids: list[int],
        add_tags: list[str],
        remove_tags: list[str],
    ) -> dict[str, int]:
        if not image_ids:
            return {"updated_images": 0}
        with self.connect() as conn:
            placeholders = ",".join("?" for _ in image_ids)
            valid_ids = [
                int(r["id"])
                for r in conn.execute(
                    f"SELECT id FROM images WHERE id IN ({placeholders})",
                    image_ids,
                ).fetchall()
            ]
            if not valid_ids:
                return {"updated_images": 0}

            to_add = self._ensure_tags(conn, add_tags)
            if to_add:
                pairs = [(img_id, t["id"]) for img_id in valid_ids for t in to_add]
                conn.executemany(
                    "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)",
                    pairs,
                )

            norm_remove = self._normalize_tag_names(remove_tags)
            if norm_remove:
                rm_placeholders = ",".join("?" for _ in norm_remove)
                rm_tag_ids = [
                    int(r["id"])
                    for r in conn.execute(
                        f"SELECT id FROM tags WHERE name IN ({rm_placeholders}) COLLATE NOCASE",
                        norm_remove,
                    ).fetchall()
                ]
                if rm_tag_ids:
                    id_ph = ",".join("?" for _ in valid_ids)
                    tag_ph = ",".join("?" for _ in rm_tag_ids)
                    conn.execute(
                        f"DELETE FROM image_tags WHERE image_id IN ({id_ph}) AND tag_id IN ({tag_ph})",
                        valid_ids + rm_tag_ids,
                    )
        return {"updated_images": len(valid_ids)}

    def delete_tag(self, tag_id: int) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
            return cur.rowcount > 0
