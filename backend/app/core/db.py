import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'md' CHECK (source IN ('md', 'pdf')),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
    content_hash TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, title)
);

-- AUTOINCREMENT: id khong bao gio dung lai, vi id nay la ID vector trong FAISS.
CREATE TABLE IF NOT EXISTS chunks (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idx     INTEGER NOT NULL,
    heading TEXT NOT NULL DEFAULT '',
    text    TEXT NOT NULL,
    UNIQUE (note_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);

-- Moi canh luu theo mot chieu; truy van hai chieu bang src OR dst.
-- wiki: dst_note co the NULL neu tieu de [[...]] chua co ghi chu (dst_title giu ten).
CREATE TABLE IF NOT EXISTS links (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    src_note  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    dst_note  INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    src_chunk INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
    dst_chunk INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
    dst_title TEXT,
    type      TEXT NOT NULL CHECK (type IN ('wiki', 'semantic')),
    score     REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_note);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_note);
CREATE INDEX IF NOT EXISTS idx_links_src_chunk ON links(src_chunk);
CREATE INDEX IF NOT EXISTS idx_links_dst_chunk ON links(dst_chunk);
CREATE INDEX IF NOT EXISTS idx_links_user_type ON links(user_id, type);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content      TEXT NOT NULL,
    sources_json TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(user_id, session_id);
"""


SCHEMA_VERSION = 3

# v2: phien ban ghi chu (de gop ba chieu) + nhat ky su kien (de dong bo truc tiep).
MIGRATION_V2 = """
CREATE TABLE IF NOT EXISTS note_versions (
    note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    device_id  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (note_id, version)
);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('created', 'updated', 'deleted')),
    note_id    INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    device_id  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, id);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _migrate(conn: sqlite3.Connection) -> None:
    if conn.execute("PRAGMA user_version").fetchone()[0] >= SCHEMA_VERSION:
        return
    cols = _columns(conn, "notes")
    if "version" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if "has_conflict" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN has_conflict INTEGER NOT NULL DEFAULT 0")
    if "client_id" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN client_id TEXT")
    # v3: file PDF goc (duong dan tuong doi trong uploads/ + ten file hien thi)
    if "file_path" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN file_path TEXT")
    if "file_name" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN file_name TEXT")
    conn.executescript(MIGRATION_V2)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client ON notes(user_id, client_id) "
        "WHERE client_id IS NOT NULL"
    )
    # Ghi chu co san (vd nhap tu thu muc) chua co dong phien ban: tao phien ban 1 de lam goc gop.
    conn.execute(
        "INSERT INTO note_versions(note_id, version, title, content) "
        "SELECT id, version, title, content FROM notes WHERE id NOT IN (SELECT note_id FROM note_versions)"
    )
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
    _migrate(conn)
