import sqlite3

from app.core.db import connect, init_db


def _setup():
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a', 'x'), ('b', 'x')")
    return conn


def _note(conn, user_id, title):
    cur = conn.execute("INSERT INTO notes(user_id, title, content) VALUES (?, ?, 'c')", (user_id, title))
    return cur.lastrowid


def test_unique_title_per_user():
    conn = _setup()
    _note(conn, 1, "RAG")
    _note(conn, 2, "RAG")  # user khac duoc phep trung tieu de
    try:
        _note(conn, 1, "RAG")
        raise AssertionError("expected IntegrityError")
    except sqlite3.IntegrityError:
        pass


def test_delete_note_cascades_to_chunks_and_links():
    conn = _setup()
    n1, n2 = _note(conn, 1, "A"), _note(conn, 1, "B")
    c1 = conn.execute("INSERT INTO chunks(note_id, user_id, idx, text) VALUES (?, 1, 0, 't')", (n1,)).lastrowid
    c2 = conn.execute("INSERT INTO chunks(note_id, user_id, idx, text) VALUES (?, 1, 0, 't')", (n2,)).lastrowid
    conn.execute(
        "INSERT INTO links(user_id, src_note, dst_note, src_chunk, dst_chunk, type, score) "
        "VALUES (1, ?, ?, ?, ?, 'semantic', 0.8)", (n1, n2, c1, c2))
    conn.execute("DELETE FROM notes WHERE id = ?", (n1,))
    assert conn.execute("SELECT COUNT(*) FROM chunks WHERE note_id = ?", (n1,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM links").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM chunks WHERE note_id = ?", (n2,)).fetchone()[0] == 1


def test_unresolved_wikilink_allowed():
    conn = _setup()
    n1 = _note(conn, 1, "A")
    conn.execute(
        "INSERT INTO links(user_id, src_note, dst_note, dst_title, type) VALUES (1, ?, NULL, 'Chua co', 'wiki')",
        (n1,))
    assert conn.execute("SELECT dst_title FROM links").fetchone()[0] == "Chua co"


def test_chunk_ids_not_reused():
    conn = _setup()
    n = _note(conn, 1, "A")
    c1 = conn.execute("INSERT INTO chunks(note_id, user_id, idx, text) VALUES (?, 1, 0, 't')", (n,)).lastrowid
    conn.execute("DELETE FROM chunks WHERE id = ?", (c1,))
    c2 = conn.execute("INSERT INTO chunks(note_id, user_id, idx, text) VALUES (?, 1, 0, 't')", (n,)).lastrowid
    assert c2 > c1


def test_migration_from_v2_adds_file_columns():
    import sqlite3 as sq
    from app.core import db as dbm

    conn = sq.connect(":memory:")
    conn.row_factory = sq.Row
    conn.executescript(dbm.SCHEMA)
    conn.execute("ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    conn.execute("ALTER TABLE notes ADD COLUMN has_conflict INTEGER NOT NULL DEFAULT 0")
    conn.execute("ALTER TABLE notes ADD COLUMN client_id TEXT")
    conn.executescript(dbm.MIGRATION_V2)
    conn.execute("PRAGMA user_version = 2")
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x')")
    conn.execute("INSERT INTO notes(user_id, title, content) VALUES (1, 'cu', 'c')")
    dbm.init_db(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(notes)")}
    assert {"file_path", "file_name"} <= cols
    assert conn.execute("PRAGMA user_version").fetchone()[0] == dbm.SCHEMA_VERSION
    dbm.init_db(conn)  # chay lai khong loi
