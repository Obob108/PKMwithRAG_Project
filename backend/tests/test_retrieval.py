from app.core.db import connect, init_db
from app.services.indexer import index_note, upsert_note
from app.services.rag import NO_CONTEXT_ANSWER, answer_question
from app.services.retrieval import retrieve
from tests.fakes import FakeEmbedder, FakeLLM, FakeStores

A = "retrieval augmented generation vector search embeddings"
B = "vector search embeddings faiss index"      # chung 3 tu voi A, khong chung tu nao voi cau hoi
C = "nau pho bo voi que va hoa hoi"             # khong lien quan gi
QUESTION = "retrieval augmented generation"      # chi giong A


def _setup(notes, link_threshold=0.3):
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x'), ('b','x')")
    conn.commit()
    stores, emb = FakeStores(), FakeEmbedder()
    ids = {}
    for user_id, title, content in notes:
        ids[title] = upsert_note(conn, user_id, title, content)
        index_note(conn, stores, emb, ids[title], link_threshold=link_threshold)
    return conn, stores, emb, ids


def test_vector_only_returns_nearest():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1, use_graph=False)
    assert [h.title for h in hits] == ["A"] and hits[0].via == "vector"


def test_graph_expansion_adds_linked_chunk():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1, context_k=5)
    by_title = {h.title: h for h in hits}
    assert by_title["A"].via == "vector"
    assert by_title["B"].via == "graph"      # B khong giong cau hoi, den qua canh semantic
    assert "C" not in by_title               # C khong co canh nao toi A


def test_expansion_works_in_both_edge_directions():
    # B duoc lap chi muc TRUOC A: canh luu A -> B, van phai doc duoc tu A sang B.
    conn, stores, emb, ids = _setup([(1, "B", B), (1, "A", A)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1)
    assert {h.title for h in hits} == {"A", "B"}


def test_via_both_when_chunk_in_both_lists():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "A2", A + " them")])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=2)
    assert all(h.via == "both" for h in hits)


def test_wiki_expansion_picks_linked_note_chunks():
    conn, stores, emb, ids = _setup([(1, "C", C), (1, "A", A + " [[C]]")])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1)
    assert {h.title: h.via for h in hits} == {"A": "vector", "C": "graph"}


def test_context_k_limits_results_and_sorted_by_rrf():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, context_k=2)
    assert len(hits) == 2
    assert hits[0].score >= hits[1].score


def test_graph_weight_zero_matches_vector_ranking():
    # Voi RRF can bang, chunk lien ke hat giong co the vuot chinh hat giong (nho canh do thi).
    # graph_weight=0 phai cho ra dung thu tu cua vector thuan.
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    pure = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, use_graph=False)
    zero = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, graph_weight=0.0)
    assert [h.chunk_id for h in zero] == [h.chunk_id for h in pure]
    assert pure[0].title == "A"


def test_other_users_chunks_never_returned():
    conn, stores, emb, ids = _setup([(1, "A", A), (2, "A_user2", A)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION)
    assert [h.title for h in hits] == ["A"]
    # ke ca khi store cua user 1 vo tinh chua vector cua user 2, SQL van loc theo user_id
    other_chunk = conn.execute("SELECT id FROM chunks WHERE user_id = 2").fetchone()[0]
    stores.get(1).add([other_chunk], stores.get(2).vectors[other_chunk].reshape(1, -1))
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION)
    assert all(h.title != "A_user2" for h in hits)


def test_empty_store_returns_nothing():
    conn, stores, emb, ids = _setup([])
    assert retrieve(conn, stores.get(1), emb, 1, QUESTION) == []


def test_answer_builds_numbered_context_and_sources():
    conn, stores, emb, ids = _setup([(1, "A", "# Muc\n" + A), (1, "B", B)])
    llm = FakeLLM("Dung vector [1].")
    out = answer_question(conn, stores.get(1), emb, llm, 1, QUESTION, top_k=1)
    prompt, system = llm.prompts[0]
    assert "[1] (A › Muc)" in prompt and "[2] (B)" in prompt
    assert prompt.endswith("CÂU HỎI: " + QUESTION)
    assert "Chỉ trả lời dựa trên" in system
    assert out["answer"] == "Dung vector [1]."
    assert [(s["n"], s["title"], s["via"]) for s in out["sources"]] == [(1, "A", "vector"), (2, "B", "graph")]


def test_answer_without_hits_skips_llm():
    conn, stores, emb, ids = _setup([])
    llm = FakeLLM()
    out = answer_question(conn, stores.get(1), emb, llm, 1, QUESTION)
    assert out["answer"] == NO_CONTEXT_ANSWER and out["sources"] == [] and llm.prompts == []


def test_supplement_keeps_vector_top_and_adds_graph_chunk():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1, context_k=2,
                    graph_mode="supplement", graph_slots=1)
    assert [(h.title, h.via) for h in hits] == [("A", "vector"), ("B", "graph")]


def test_supplement_zero_slots_equals_vector_only():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    pure = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, context_k=3, use_graph=False)
    supp = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, context_k=3,
                    graph_mode="supplement", graph_slots=0)
    assert [h.chunk_id for h in supp] == [h.chunk_id for h in pure]


def test_supplement_never_displaces_top_vector_hit():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B), (1, "C", C)])
    for slots in (1, 2, 3):
        hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=3, context_k=3,
                        graph_mode="supplement", graph_slots=slots)
        assert hits[0].title == "A"


def test_supplement_fills_with_vector_when_no_graph_candidates():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "C", C)])  # A va C khong co canh
    hits = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=2, context_k=2,
                    graph_mode="supplement", graph_slots=1)
    assert {h.title for h in hits} == {"A", "C"}


def test_min_edge_score_filters_weak_semantic_edges():
    conn, stores, emb, ids = _setup([(1, "A", A), (1, "B", B)])  # canh A-B co diem khoang 0.55
    weak = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1, context_k=5, min_edge_score=0.9)
    assert [h.title for h in weak] == ["A"]
    kept = retrieve(conn, stores.get(1), emb, 1, QUESTION, top_k=1, context_k=5, min_edge_score=0.3)
    assert {h.title for h in kept} == {"A", "B"}


def test_invalid_graph_mode_raises():
    conn, stores, emb, ids = _setup([(1, "A", A)])
    try:
        retrieve(conn, stores.get(1), emb, 1, QUESTION, graph_mode="nope")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
