import sqlite3

from app.core.db import SCHEMA, connect, init_db
from app.services import notes
from app.services.indexer import delete_note as delete_note_index
from app.services.indexer import index_note, upsert_note
from tests.fakes import FakeEmbedder, FakeStores


def _conn():
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x'), ('b','x')")
    conn.commit()
    return conn


def test_create_records_version_and_event():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "noi dung", device_id="phone")
    assert n["version"] == 1 and n["status"] == "pending" and n["has_conflict"] is False
    assert conn.execute("SELECT content FROM note_versions WHERE note_id = ? AND version = 1", (n["id"],)).fetchone()[0] == "noi dung"
    ev = notes.changes_since(conn, 1, 0)
    assert [(e["type"], e["note_id"], e["device_id"]) for e in ev] == [("created", n["id"], "phone")]


def test_create_is_idempotent_with_client_id_and_suffixes_duplicate_titles():
    conn = _conn()
    a = notes.create_note(conn, 1, "KH", "x", client_id="uuid-1")
    again = notes.create_note(conn, 1, "KH", "x", client_id="uuid-1")
    assert again["id"] == a["id"] and len(notes.list_notes(conn, 1)) == 1
    other = notes.create_note(conn, 1, "KH", "y", client_id="uuid-2")
    assert other["title"] == "KH (2)"
    assert notes.create_note(conn, 2, "KH", "z")["title"] == "KH"  # user khac khong bi anh huong


def test_update_with_current_base_applies():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a\nb\n")
    r = notes.update_note(conn, 1, n["id"], content="a\nB\n", base_version=1)
    assert r["result"] == "ok" and r["changed"] and r["note"]["version"] == 2 and r["note"]["status"] == "pending"


def test_offline_edits_are_merged_not_replaced():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a\nb\nc\nd\n")
    notes.update_note(conn, 1, n["id"], content="a\nB\nc\nd\n", base_version=1, device_id="desktop")
    # dien thoai ngoai tuyen, van o phien ban 1, sua dong cuoi
    r = notes.update_note(conn, 1, n["id"], content="a\nb\nc\nD\n", base_version=1, device_id="phone")
    assert r["result"] == "merged" and r["note"]["content"] == "a\nB\nc\nD\n" and r["note"]["version"] == 3
    assert r["note"]["has_conflict"] is False


def test_conflict_keeps_both_and_can_be_resolved():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a\nb\nc\n")
    notes.update_note(conn, 1, n["id"], content="a\nB1\nc\n", base_version=1)
    r = notes.update_note(conn, 1, n["id"], content="a\nB2\nc\n", base_version=1)
    assert r["result"] == "conflict" and r["note"]["has_conflict"] is True
    assert "B1" in r["note"]["content"] and "B2" in r["note"]["content"]
    fixed = notes.update_note(conn, 1, n["id"], content="a\nB1 va B2\nc\n", base_version=r["note"]["version"])
    assert fixed["result"] == "ok" and fixed["note"]["has_conflict"] is False


def test_noop_does_not_bump_version():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a\n")
    r = notes.update_note(conn, 1, n["id"], content="a\n", base_version=1)
    assert r["changed"] is False and r["note"]["version"] == 1 and len(notes.changes_since(conn, 1, 0)) == 1


def test_bad_base_version_rejected():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a")
    for bad in (0, 5):
        try:
            notes.update_note(conn, 1, n["id"], content="x", base_version=bad)
            raise AssertionError("expected BadVersion")
        except notes.BadVersion:
            pass


def test_missing_base_version_row_falls_back_to_conflict_block():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a\n")
    notes.update_note(conn, 1, n["id"], content="b\n", base_version=1)
    conn.execute("DELETE FROM note_versions WHERE note_id = ? AND version = 1", (n["id"],))
    r = notes.update_note(conn, 1, n["id"], content="c\n", base_version=1)
    assert r["result"] == "conflict" and "b\n" in r["note"]["content"] and "c\n" in r["note"]["content"]


def test_title_changes():
    conn = _conn()
    a = notes.create_note(conn, 1, "A", "x")
    notes.create_note(conn, 1, "B", "y")
    r = notes.update_note(conn, 1, a["id"], content="x", base_version=1, title="A moi")
    assert r["note"]["title"] == "A moi"
    try:
        notes.update_note(conn, 1, a["id"], content="x", base_version=2, title="B")
        raise AssertionError("expected TitleTaken")
    except notes.TitleTaken:
        pass
    # thiet bi cu (base 1) doi ten, may chu da doi ten khac -> giu ten may chu
    notes.update_note(conn, 1, a["id"], content="x", base_version=2, title="A may chu")
    r = notes.update_note(conn, 1, a["id"], content="x", base_version=1, title="A thiet bi")
    assert r["note"]["title"] == "A may chu"


def test_user_isolation_and_not_found():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "x")
    for fn in (lambda: notes.get_note(conn, 2, n["id"]),
               lambda: notes.update_note(conn, 2, n["id"], content="h", base_version=1),
               lambda: notes.delete_note(conn, 2, n["id"])):
        try:
            fn()
            raise AssertionError("expected NotFound")
        except notes.NotFound:
            pass
    assert notes.list_notes(conn, 2) == []
    assert notes.changes_since(conn, 2, 0) == []


def test_delete_cascades_and_emits_event():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "x")
    cursor = notes.latest_event_id(conn, 1)
    notes.delete_note(conn, 1, n["id"], device_id="phone")
    assert conn.execute("SELECT COUNT(*) FROM note_versions").fetchone()[0] == 0
    ev = notes.changes_since(conn, 1, cursor)
    assert [(e["type"], e["note_id"]) for e in ev] == [("deleted", n["id"])]
    try:
        notes.update_note(conn, 1, n["id"], content="x", base_version=1)
        raise AssertionError("expected NotFound")
    except notes.NotFound:
        pass


def test_changes_since_cursor_and_limit():
    conn = _conn()
    n = notes.create_note(conn, 1, "KH", "a")
    c1 = notes.latest_event_id(conn, 1)
    notes.update_note(conn, 1, n["id"], content="b", base_version=1)
    notes.update_note(conn, 1, n["id"], content="c", base_version=2)
    assert [e["version"] for e in notes.changes_since(conn, 1, c1)] == [2, 3]
    assert len(notes.changes_since(conn, 1, 0, limit=2)) == 2


def test_migration_from_v1_schema_backfills_versions_and_is_idempotent():
    conn = connect(":memory:")
    conn.executescript(SCHEMA)  # schema cu: chua co version/has_conflict/client_id
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x')")
    conn.execute("INSERT INTO notes(user_id, title, content) VALUES (1, 'Cu', 'noi dung cu')")
    conn.commit()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    init_db(conn)
    init_db(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(notes)")}
    assert {"version", "has_conflict", "client_id"} <= cols
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    rows = conn.execute("SELECT note_id, version, content FROM note_versions").fetchall()
    assert [(r[0], r[1], r[2]) for r in rows] == [(1, 1, "noi dung cu")]
    r = notes.update_note(conn, 1, 1, content="moi", base_version=1)  # ghi chu cu dung duoc binh thuong
    assert r["note"]["version"] == 2


def test_related_notes_and_graph():
    conn = _conn()
    stores, emb = FakeStores(), FakeEmbedder(dim=1024)  # nhieu chieu de tranh va cham bam giua cac ghi chu khong lien quan
    texts = {"A": "retrieval augmented generation vector search embeddings [[C]]",
             "B": "vector search embeddings faiss index",
             "C": "nau pho bo voi que va hoa hoi",
             "D": "mot ghi chu khong dinh den ai khac"}
    ids = {}
    for title, text in texts.items():
        ids[title] = upsert_note(conn, 1, title, text)
        index_note(conn, stores, emb, ids[title], link_threshold=0.3)
    rel = {r["title"]: r for r in notes.related_notes(conn, 1, ids["A"])}
    assert set(rel) == {"B", "C"} and rel["C"]["wiki"] is True and rel["B"]["semantic_score"] >= 0.3
    assert [r["title"] for r in notes.related_notes(conn, 1, ids["A"])][0] == "C"  # wiki xep truoc
    assert {r["title"] for r in notes.related_notes(conn, 1, ids["B"])} == {"A"}  # doc duoc ca chieu nguoc
    g = notes.graph(conn, 1)
    assert {n["title"] for n in g["nodes"]} == {"A", "B", "C", "D"}
    assert {(e["source"], e["target"]) for e in g["edges"]} == {(ids["A"], ids["B"]), (ids["A"], ids["C"])}
    assert [n["degree"] for n in g["nodes"] if n["title"] == "D"] == [0]
    strict = notes.graph(conn, 1, min_score=0.99)
    assert [(e["source"], e["target"]) for e in strict["edges"]] == [(ids["A"], ids["C"])]  # chi con wiki
    try:
        notes.related_notes(conn, 2, ids["A"])
        raise AssertionError("expected NotFound")
    except notes.NotFound:
        pass


def test_indexer_delete_uses_service_and_removes_vectors():
    conn = _conn()
    stores, emb = FakeStores(), FakeEmbedder()
    nid = upsert_note(conn, 1, "A", "mot hai ba")
    index_note(conn, stores, emb, nid)
    assert len(stores.get(1)) == 1
    delete_note_index(conn, stores, nid, device_id="web")
    assert len(stores.get(1)) == 0
    assert notes.changes_since(conn, 1, 0)[-1]["type"] == "deleted"


def test_file_attached_listed_served_and_removed_on_delete(tmp_path):
    conn = _conn()
    (tmp_path / "1").mkdir()
    (tmp_path / "1" / "a.pdf").write_bytes(b"%PDF-1.4 x")
    n = notes.create_note(conn, 1, "Tai lieu", "noi dung", source="pdf",
                          file_path="1/a.pdf", file_name="Tai lieu.pdf")
    assert n["has_file"] is True and n["file_name"] == "Tai lieu.pdf"
    path, name = notes.get_file(conn, 1, n["id"], tmp_path)
    assert path.read_bytes().startswith(b"%PDF") and name == "Tai lieu.pdf"
    g = notes.graph(conn, 1)["nodes"][0]
    assert g["source"] == "pdf" and g["has_file"] is True
    try:
        notes.get_file(conn, 2, n["id"], tmp_path)  # user khac khong duoc xem
        raise AssertionError("expected NotFound")
    except notes.NotFound:
        pass
    notes.delete_note(conn, 1, n["id"], upload_dir=tmp_path)
    assert not (tmp_path / "1" / "a.pdf").exists()


def test_file_path_traversal_is_rejected(tmp_path):
    conn = _conn()
    secret = tmp_path / "secret.txt"
    secret.write_text("x")
    up = tmp_path / "uploads"
    up.mkdir()
    n = notes.create_note(conn, 1, "Xau", "c", source="pdf", file_path="../secret.txt", file_name="s.pdf")
    assert notes.get_file(conn, 1, n["id"], up) is None
    notes.delete_note(conn, 1, n["id"], upload_dir=up)
    assert secret.exists()  # khong bi xoa nham


def test_note_without_file():
    conn = _conn()
    n = notes.create_note(conn, 1, "Thuong", "c")
    assert n["has_file"] is False and notes.get_file(conn, 1, n["id"], __import__("pathlib").Path(".")) is None
    assert "content" not in notes.list_notes(conn, 1)[0]
    assert notes.list_notes(conn, 1, with_content=True)[0]["content"] == "c"
