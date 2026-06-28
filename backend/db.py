import sqlite3
import json
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).parent / "data.db"


def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                duration INTEGER,
                thumbnail_path TEXT,
                download_status TEXT DEFAULT 'pending',
                download_error TEXT,
                download_progress REAL DEFAULT 0,
                download_total TEXT,
                download_speed TEXT,
                transcribe_status TEXT DEFAULT 'pending',
                transcribe_error TEXT,
                ideas_status TEXT DEFAULT 'pending',
                ideas_error TEXT,
                ideas TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS exports (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                title TEXT,
                description TEXT,
                status TEXT DEFAULT 'pending',
                error TEXT,
                file_path TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.commit()


# ── Settings helpers ──────────────────────────────────────────────────────

def get_setting(key: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
        conn.commit()


def get_all_settings() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


def row_to_dict(row) -> dict:
    if row is None:
        return None
    d = dict(row)
    # Parse ideas from JSON string to list
    if d.get("ideas") and isinstance(d["ideas"], str):
        try:
            d["ideas"] = json.loads(d["ideas"])
        except (json.JSONDecodeError, ValueError):
            d["ideas"] = []
    elif not d.get("ideas"):
        d["ideas"] = []
    return d


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_video(video_id: str, url: str, title: str, duration: int) -> dict:
    ts = now_iso()
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO videos (id, url, title, duration,
                download_status, transcribe_status, ideas_status,
                created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 'pending', 'pending', ?, ?)
        """, (video_id, url, title, duration, ts, ts))
        conn.commit()
    return get_video(video_id)


def get_video(video_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    return row_to_dict(row)


def list_videos() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM videos ORDER BY created_at DESC").fetchall()
    return [row_to_dict(r) for r in rows]


def delete_video(video_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        conn.commit()


def update_video(video_id: str, **fields):
    if not fields:
        return
    fields["updated_at"] = now_iso()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [video_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE videos SET {set_clause} WHERE id = ?", values)
        conn.commit()

# ── Export helpers ────────────────────────────────────────────────────────

def insert_export(export_id: str, video_id: str, title: str, description: str = None) -> dict:
    ts = now_iso()
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO exports (id, video_id, title, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
        """, (export_id, video_id, title, description, ts, ts))
        conn.commit()
    return get_export(export_id)


def get_export(export_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM exports WHERE id = ?", (export_id,)).fetchone()
    return row_to_dict(row)


def list_exports() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM exports ORDER BY created_at DESC").fetchall()
    return [row_to_dict(r) for r in rows]


def update_export(export_id: str, **fields):
    if not fields:
        return
    fields["updated_at"] = now_iso()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [export_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE exports SET {set_clause} WHERE id = ?", values)
        conn.commit()


def delete_export(export_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM exports WHERE id = ?", (export_id,))
        conn.commit()
