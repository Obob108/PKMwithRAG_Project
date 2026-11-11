from app.core.db import connect, init_db
from app.services.graph_stats import note_degrees
from app.services.indexer import index_note, upsert_note
from tests.fakes import FakeEmbedder, FakeStores


def test_note_degrees_counts_edges_in_both_directions():
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x')")
    conn.commit()
    stores, emb = FakeStores(), FakeEmbedder()
    for title, text in (("A", "retrieval augmented generation vector search embeddings"),
                        ("B", "vector search embeddings faiss index"),
                        ("C", "nau pho bo voi que va hoa hoi")):
        index_note(conn, stores, emb, upsert_note(conn, 1, title, text), link_threshold=0.3)
    deg = {d["title"]: d for d in note_degrees(conn, 1)}
    assert deg["A"]["edges"] == 1 and deg["B"]["edges"] == 1 and deg["C"]["edges"] == 0
    assert deg["A"]["chunks"] == 1 and deg["A"]["edges_per_chunk"] == 1.0
    assert 0.3 <= deg["A"]["avg_score"] <= 1.0 and deg["C"]["avg_score"] == 0.0
    assert [d["title"] for d in note_degrees(conn, 1)][-1] == "C"  # bac cao xep truoc
