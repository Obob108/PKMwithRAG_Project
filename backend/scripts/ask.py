"""Hoi dap tren ghi chu cua mot user (chay tu thu muc backend).

    python scripts/ask.py --user alice "RAG khac gi voi semantic linking?"
    python scripts/ask.py --user alice "..." --compare      # so vector thuan vs truy hoi lai (khong goi LLM)
    python scripts/ask.py --user alice "..." --no-graph     # chi vector
    python scripts/ask.py --user alice "..." --no-llm       # chi in cac chunk truy hoi duoc
    python scripts/ask.py --user alice "..." --graph-weight 0.5
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.embedding import Embedder  # noqa: E402
from app.services.llm import GeminiClient  # noqa: E402
from app.services.rag import answer_question  # noqa: E402
from app.services.retrieval import retrieve  # noqa: E402
from app.services.vector_store import VectorStores  # noqa: E402


def print_hits(title, hits):
    print(f"--- {title} ---")
    for n, h in enumerate(hits, 1):
        where = h.title + (f" > {h.heading}" if h.heading else "")
        print(f"[{n}] {h.via:<6} rrf={h.score:.4f} cos={h.vector_score:.3f}  {where}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("question")
    p.add_argument("--user", required=True)
    p.add_argument("--no-graph", action="store_true")
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--compare", action="store_true")
    p.add_argument("--graph-weight", type=float, default=1.0)
    p.add_argument("--top-k", type=int, default=None)
    p.add_argument("--context-k", type=int, default=None)
    args = p.parse_args()

    s = get_settings()
    conn = connect(s.db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'.")
    uid = user["id"]
    store = VectorStores(s.faiss_dir).get(uid)
    embedder = Embedder(s.embedding_model)
    kw = dict(
        top_k=args.top_k or s.retrieve_top_k,
        context_k=args.context_k or s.context_top_k,
        rrf_k=s.rrf_k,
        graph_weight=args.graph_weight,
    )

    if args.compare:
        print_hits("VECTOR THUAN", retrieve(conn, store, embedder, uid, args.question, use_graph=False, **kw))
        print_hits("TRUY HOI LAI", retrieve(conn, store, embedder, uid, args.question, use_graph=True, **kw))
        return
    if args.no_llm:
        print_hits("TRUY HOI", retrieve(conn, store, embedder, uid, args.question, use_graph=not args.no_graph, **kw))
        return

    llm = GeminiClient(s.gemini_api_key, s.gemini_model)
    out = answer_question(conn, store, embedder, llm, uid, args.question, use_graph=not args.no_graph, **kw)
    print(out["answer"], "\n")
    print_hits("NGUON", out["hits"])


if __name__ == "__main__":
    main()
