import json
import tempfile
from pathlib import Path

from app.core.db import connect, init_db
from app.services.evaluation import (
    Config, Question, all_gold_at_k, default_configs, evaluate, load_questions, missing_gold,
    ranked_notes, recall_at_k, reciprocal_rank, summarize,
)
from app.services.indexer import index_note, upsert_note
from tests.fakes import FakeEmbedder, FakeStores

A = "retrieval augmented generation vector search embeddings"
B = "vector search embeddings faiss index"
C = "nau pho bo voi que va hoa hoi"


def test_metrics():
    ranked = ["x", "a", "y", "b"]
    assert recall_at_k(ranked, ["a", "b"], 2) == 0.5
    assert recall_at_k(ranked, ["a", "b"], 4) == 1.0
    assert reciprocal_rank(ranked, ["b", "a"]) == 0.5
    assert reciprocal_rank(ranked, ["zzz"]) == 0.0
    assert all_gold_at_k(ranked, ["a", "b"], 3) == 0.0 and all_gold_at_k(ranked, ["a", "b"], 4) == 1.0


def test_load_questions_and_errors():
    with tempfile.TemporaryDirectory() as d:
        ok = Path(d) / "q.jsonl"
        ok.write_text('# ghi chu\n\n{"id":"1","question":"q?","gold_notes":["A","B"],"type":"multi"}\n', encoding="utf-8")
        qs = load_questions(ok)
        assert qs == [Question("1", "q?", ("A", "B"), "multi", "")]
        assert qs[0].gold_notes == (("A",), ("B",))
        bad = Path(d) / "bad.jsonl"
        bad.write_text(json.dumps({"id": "1", "question": "q", "gold_notes": []}), encoding="utf-8")
        try:
            load_questions(bad)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "dong 1" in str(exc)


def _env():
    conn = connect(":memory:")
    init_db(conn)
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x')")
    conn.commit()
    stores, emb = FakeStores(), FakeEmbedder()
    for title, content in (("A", A), ("B", B), ("C", C)):
        index_note(conn, stores, emb, upsert_note(conn, 1, title, content), link_threshold=0.3)
    return conn, stores, emb


def test_missing_gold_detects_typos():
    conn, _, _ = _env()
    qs = [Question("1", "q", ("A",)), Question("2", "q", ("A", "Typo"))]
    assert missing_gold(conn, 1, qs) == {"2": ["Typo"]}


def test_graph_improves_multi_note_recall():
    conn, stores, emb = _env()
    qs = [Question("m", "retrieval augmented generation", ("A", "B"), "multi"),
          Question("d", "retrieval augmented generation", ("A",), "direct")]
    rows = evaluate(conn, stores.get(1), emb, 1, qs,
                    [Config("vector", False), Config("hybrid", True, 1.0)], top_k=1, context_k=5)
    table = {(s["config"], s["type"]): s for s in summarize(rows)}
    assert table[("vector", "multi")]["recall@5"] == 0.5 and table[("vector", "multi")]["all@5"] == 0.0
    assert table[("hybrid", "multi")]["recall@5"] == 1.0 and table[("hybrid", "multi")]["all@5"] == 1.0
    assert table[("hybrid", "direct")]["recall@5"] == 1.0
    assert ("vector", "all") in table and table[("vector", "all")]["n"] == 2


def test_embedder_called_once_per_question_across_configs():
    conn, stores, emb = _env()
    emb.calls = 0
    qs = [Question("1", "retrieval augmented generation", ("A",))]
    evaluate(conn, stores.get(1), emb, 1, qs, default_configs((0.5, 1.0)), top_k=3, context_k=3)
    assert emb.calls == 1


def test_ranked_notes_dedupes_in_order():
    class H:  # gia lap Hit
        def __init__(self, title): self.title = title
    assert ranked_notes([H("a"), H("b"), H("a"), H("c")]) == ["a", "b", "c"]


def test_alternative_groups():
    gold = ["A", ["B", "B_pdf"]]
    assert recall_at_k(["B_pdf", "x"], gold, 2) == 0.5       # B_pdf thoa y thu 2, thieu A
    assert recall_at_k(["A", "B_pdf"], gold, 2) == 1.0
    assert all_gold_at_k(["A", "B"], gold, 2) == 1.0
    assert reciprocal_rank(["x", "B_pdf"], gold) == 0.5


def test_load_questions_with_alternatives_and_missing_gold():
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "q.jsonl"
        f.write_text('{"id":"1","question":"q","gold_notes":["A",["B","Typo"]],"type":"multi"}\n', encoding="utf-8")
        qs = load_questions(f)
        assert qs[0].gold_notes == (("A",), ("B", "Typo"))
        conn, _, _ = _env()
        assert missing_gold(conn, 1, qs) == {"1": ["Typo"]}


def test_split_questions_alternates_and_covers_all():
    from app.services.evaluation import split_questions
    qs = [Question(str(i), "q", ("A",)) for i in range(1, 8)]
    dev, test = split_questions(qs, "dev"), split_questions(qs, "test")
    assert [q.id for q in dev] == ["2", "4", "6"] and [q.id for q in test] == ["1", "3", "5", "7"]
    assert {q.id for q in dev} | {q.id for q in test} == {q.id for q in qs}
    assert len(split_questions(qs, "all")) == 7


def test_supplement_config_and_regressions():
    from app.services.evaluation import regressions
    conn, stores, emb = _env()
    qs = [Question("m", "retrieval augmented generation", ("A", "B"), "multi")]
    cfgs = [Config("vector", False), Config("supp", True, mode="supplement", slots=1)]
    rows = evaluate(conn, stores.get(1), emb, 1, qs, cfgs, top_k=1, context_k=2)
    table = {(s["config"], s["type"]): s for s in summarize(rows)}
    assert table[("vector", "multi")]["all@5"] == 0.0 and table[("supp", "multi")]["all@5"] == 1.0
    assert regressions(rows, "supp") == []  # khong te hon vector
    assert [r["id"] for r in regressions(rows, "vector", baseline="supp")] == ["m"]


def test_default_configs_names():
    names = [c.name for c in default_configs((0.5,), (1,), (0.0, 0.75))]
    assert names == ["vector", "rrf w=0.5", "supp s=1", "supp s=1 e>=0.75"]


def test_paired_diff_counts_and_ci():
    from app.services.evaluation import paired_diff
    def row(cfg, qid, qtype, v, rr=1.0):
        return {"config": cfg, "id": qid, "type": qtype, "all@5": v, "rr": rr}
    rows = [row("vector", "1", "multi", 0.0), row("vector", "2", "multi", 0.0),
            row("vector", "3", "multi", 1.0), row("vector", "4", "direct", 1.0),
            row("x", "1", "multi", 1.0), row("x", "2", "multi", 1.0),
            row("x", "3", "multi", 1.0), row("x", "4", "direct", 0.0)]
    d = paired_diff(rows, "x", "vector", "all@5", "multi")
    assert d["n"] == 3 and (d["better"], d["worse"], d["tie"]) == (2, 0, 1)
    assert abs(d["mean"] - 2 / 3) < 1e-9 and d["lo"] <= d["mean"] <= d["hi"]
    d_all = paired_diff(rows, "x", "vector", "all@5", "all")
    assert d_all["n"] == 4 and (d_all["better"], d_all["worse"]) == (2, 1)
    assert paired_diff(rows, "x", "vector", "all@5", "nonexistent") is None
    assert paired_diff(rows, "x", "vector", "all@5", "multi", seed=1) == paired_diff(rows, "x", "vector", "all@5", "multi", seed=1)
