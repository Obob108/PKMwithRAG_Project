from app.core.db import connect, init_db
from app.services.indexer import delete_note, index_note, upsert_note
from tests.fakes import FakeEmbedder, FakeStores

RAG_A = "Retrieval augmented generation dung vector search va embeddings cho question answering"
RAG_B = "Embeddings va vector search giup retrieval augmented generation cho question answering tot hon"
PHO = "Cach nau pho bo voi hanh tay va que, ham xuong bo nhieu gio"


def _setup():
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x'), ('b','x')")
    conn.commit()
    return conn, FakeStores(), FakeEmbedder()


def _count(conn, sql, *args):
    return conn.execute(sql, args).fetchone()[0]


def test_index_creates_chunks_and_vectors():
    conn, stores, emb = _setup()
    nid = upsert_note(conn, 1, "A", "# Muc 1\n" + RAG_A + "\n\n# Muc 2\n" + PHO)
    assert index_note(conn, stores, emb, nid) == "ready"
    n_chunks = _count(conn, "SELECT COUNT(*) FROM chunks WHERE note_id = ?", nid)
    assert n_chunks == 2 and len(stores.get(1)) == 2
    assert conn.execute("SELECT status FROM notes WHERE id = ?", (nid,)).fetchone()[0] == "ready"


def test_semantic_links_only_for_similar_notes():
    conn, stores, emb = _setup()
    a = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, a, link_threshold=0.5)
    b = upsert_note(conn, 1, "B", RAG_B)
    index_note(conn, stores, emb, b, link_threshold=0.5)
    c = upsert_note(conn, 1, "C", PHO)
    index_note(conn, stores, emb, c, link_threshold=0.5)
    links = conn.execute("SELECT src_note, dst_note, score FROM links WHERE type='semantic'").fetchall()
    assert [(r["src_note"], r["dst_note"]) for r in links] == [(b, a)]
    assert links[0]["score"] >= 0.5


def test_reindex_replaces_old_chunks_and_vectors():
    conn, stores, emb = _setup()
    nid = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, nid)
    old_ids = {r[0] for r in conn.execute("SELECT id FROM chunks WHERE note_id = ?", (nid,))}
    upsert_note(conn, 1, "A", PHO)  # doi noi dung
    index_note(conn, stores, emb, nid)
    new_ids = {r[0] for r in conn.execute("SELECT id FROM chunks WHERE note_id = ?", (nid,))}
    assert old_ids.isdisjoint(new_ids)
    assert set(stores.get(1).vectors) == new_ids


def test_unchanged_note_is_not_reindexed():
    conn, stores, emb = _setup()
    nid = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, nid)
    calls = emb.calls
    upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, nid)
    assert emb.calls == calls
    index_note(conn, stores, emb, nid, force=True)
    assert emb.calls == calls + 1


def test_wikilink_resolves_when_target_created_later():
    conn, stores, emb = _setup()
    a = upsert_note(conn, 1, "A", "Xem [[B]] de biet them.")
    index_note(conn, stores, emb, a)
    row = conn.execute("SELECT dst_note, dst_title FROM links WHERE type='wiki'").fetchone()
    assert row["dst_note"] is None and row["dst_title"] == "B"
    b = upsert_note(conn, 1, "B", "Noi dung B")
    index_note(conn, stores, emb, b)
    row = conn.execute("SELECT dst_note FROM links WHERE type='wiki'").fetchone()
    assert row["dst_note"] == b


def test_failure_marks_note_failed_and_keeps_old_index():
    conn, stores, emb = _setup()
    nid = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, nid)
    upsert_note(conn, 1, "A", PHO)
    emb.fail = True
    assert index_note(conn, stores, emb, nid) == "failed"
    row = conn.execute("SELECT status, error FROM notes WHERE id = ?", (nid,)).fetchone()
    assert row["status"] == "failed" and "boom" in row["error"]
    assert _count(conn, "SELECT COUNT(*) FROM chunks WHERE note_id = ?", nid) == 1
    assert len(stores.get(1)) == 1


def test_users_are_isolated():
    conn, stores, emb = _setup()
    a = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, a, link_threshold=0.1)
    b = upsert_note(conn, 2, "B", RAG_B)  # user khac
    index_note(conn, stores, emb, b, link_threshold=0.1)
    assert _count(conn, "SELECT COUNT(*) FROM links WHERE type='semantic'") == 0
    assert len(stores.get(1)) == 1 and len(stores.get(2)) == 1


def test_delete_note_removes_vectors_and_links():
    conn, stores, emb = _setup()
    a = upsert_note(conn, 1, "A", RAG_A)
    index_note(conn, stores, emb, a, link_threshold=0.5)
    b = upsert_note(conn, 1, "B", RAG_B)
    index_note(conn, stores, emb, b, link_threshold=0.5)
    delete_note(conn, stores, a)
    assert _count(conn, "SELECT COUNT(*) FROM links") == 0
    assert _count(conn, "SELECT COUNT(*) FROM notes WHERE id = ?", a) == 0
    assert len(stores.get(1)) == 1


def test_note_without_content_is_ready_with_no_chunks():
    conn, stores, emb = _setup()
    nid = upsert_note(conn, 1, "Rong", "")
    assert index_note(conn, stores, emb, nid) == "ready"
    assert _count(conn, "SELECT COUNT(*) FROM chunks") == 0
