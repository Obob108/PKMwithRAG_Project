"""Chay danh gia truy hoi (chay tu thu muc backend):

    python scripts/run_eval.py --user alice --questions ../eval/questions.jsonl
    python scripts/run_eval.py --user alice --weights 0.25,0.5,1.0 --out ../eval/results.csv
Khong goi LLM; chi do truy hoi (R@3, R@5, MRR, all@5 o muc ghi chu).
"""
import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.embedding import Embedder  # noqa: E402
from app.services.evaluation import (  # noqa: E402
    default_configs, evaluate, load_questions, missing_gold, paired_diff, regressions, split_questions,
    summarize,
)
from app.services.vector_store import VectorStores  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user", required=True)
    p.add_argument("--questions", default="../eval/questions.jsonl")
    p.add_argument("--weights", default="0.25,0.5,1.0")
    p.add_argument("--slots", default="1,2", help="so cho do thi cho mode supplement")
    p.add_argument("--min-edges", default="0,0.75", help="nguong diem canh semantic luc truy van")
    p.add_argument("--part", default="all", choices=["all", "dev", "test"],
                   help="dev (vi tri chan) de chon cau hinh, test (vi tri le) de bao cao")
    p.add_argument("--compare", action="store_true",
                   help="in chenh lech so voi vector kem khoang tin cay 95%% (bootstrap ghep cap)")
    p.add_argument("--diff", default=None, help="in cac cau ma cau hinh nay te hon vector, vd 'rrf w=0.25'")
    p.add_argument("--top-k", type=int, default=10, help="so hat giong lay tu vector")
    p.add_argument("--context-k", type=int, default=5, help="so chunk dua vao ngu canh (dung de do)")
    p.add_argument("--out", default="../eval/results.csv")
    args = p.parse_args()

    s = get_settings()
    conn = connect(s.db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'.")
    questions = split_questions(load_questions(args.questions), args.part)
    bad = missing_gold(conn, user["id"], questions)
    if bad:
        sys.exit("Tieu de gold khong ton tai trong DB (go sai ten?):\n" +
                 "\n".join(f"  {qid}: {titles}" for qid, titles in bad.items()))

    weights = [float(w) for w in args.weights.split(",") if w.strip()]
    slots = [int(x) for x in args.slots.split(",") if x.strip()]
    min_edges = [float(x) for x in args.min_edges.split(",") if x.strip()]
    store = VectorStores(s.faiss_dir).get(user["id"])
    rows = evaluate(conn, store, Embedder(s.embedding_model), user["id"], questions,
                    default_configs(weights, slots, min_edges), top_k=args.top_k, context_k=args.context_k)

    print(f"part={args.part}, top_k={args.top_k}, context_k={args.context_k}, {len(questions)} cau")
    print(f"{'config':<20}{'type':<8}{'n':>4}{'R@3':>7}{'R@5':>7}{'MRR':>7}{'all@5':>7}")
    for r in summarize(rows):
        print(f"{r['config']:<20}{r['type']:<8}{r['n']:>4}{r['recall@3']:>7.2f}{r['recall@5']:>7.2f}"
              f"{r['mrr']:>7.2f}{r['all@5']:>7.2f}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\nChi tiet tung cau: {out}")

    if args.compare:
        print("\n== Chenh lech so voi vector (config - vector), khoang tin cay 95% ==")
        print(f"{'config':<20}{'nhom':<7}{'chi so':<7}{'chenh':>8}{'  khoang tin cay':<20}{'tot hon':>8}{'te hon':>8}{'bang':>6}")
        for cfg in dict.fromkeys(r["config"] for r in rows):
            if cfg == "vector":
                continue
            for qtype, metric in (("all", "all@5"), ("multi", "all@5"), ("all", "rr")):
                d = paired_diff(rows, cfg, "vector", metric, qtype)
                if d:
                    ci = f"  [{d['lo']:+.2f}, {d['hi']:+.2f}]"
                    label = "MRR" if metric == "rr" else metric
                    print(f"{cfg:<20}{qtype:<7}{label:<7}{d['mean']:>+8.2f}{ci:<20}{d['better']:>8}{d['worse']:>8}{d['tie']:>6}")

    if args.diff:
        bad = regressions(rows, args.diff)
        print(f"\n== {len(bad)} cau '{args.diff}' te hon vector ==")
        for r in bad:
            print(f"[{r['id']}] {r['question']}\n   gold: {r['gold']}\n   vector: {r['base_top']} (rr={r['rr_base']:.2f})"
                  f"\n   {args.diff}: {r['cfg_top']} (rr={r['rr_cfg']:.2f})")


if __name__ == "__main__":
    main()
