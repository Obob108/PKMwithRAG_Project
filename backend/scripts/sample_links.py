"""Lay mau cac cap chunk (khac ghi chu) theo khoang diem cosine de tu gan nhan, chon tau.

    python scripts/sample_links.py --user alice --n 60 --out ../eval/link_sample.csv
In so cap trong tung khoang diem, va ghi CSV (cot `label` de trong: dien 1 neu hai doan
THAT SU lien quan, 0 neu khong). Mo bang Excel; file ghi utf-8-sig.
"""
import argparse
import csv
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.vector_store import VectorStores  # noqa: E402

BINS = [(0.45, 0.55), (0.55, 0.65), (0.65, 0.75), (0.75, 0.85), (0.85, 1.01)]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user", required=True)
    p.add_argument("--n", type=int, default=60, help="tong so cap can lay mau")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--out", default="../eval/link_sample.csv")
    args = p.parse_args()

    s = get_settings()
    conn = connect(s.db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'.")
    rows = conn.execute(
        "SELECT c.id, c.note_id, c.heading, c.text, n.title FROM chunks c "
        "JOIN notes n ON n.id = c.note_id WHERE c.user_id = ? ORDER BY c.id", (user["id"],)
    ).fetchall()
    store = VectorStores(s.faiss_dir).get(user["id"])
    mat = np.stack([store.get_vector(r["id"]) for r in rows])
    sims = mat @ mat.T

    pairs = []  # moi cap khong thu tu, khac ghi chu, chi tinh mot lan
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if rows[i]["note_id"] != rows[j]["note_id"] and sims[i, j] >= BINS[0][0]:
                pairs.append((float(sims[i, j]), i, j))

    rng = random.Random(args.seed)
    per_bin = max(1, args.n // len(BINS))
    chosen = []
    print("Khoang cosine     so cap")
    for lo, hi in BINS:
        in_bin = [t for t in pairs if lo <= t[0] < hi]
        print(f"[{lo:.2f}, {min(hi, 1.0):.2f})   {len(in_bin):>6}")
        chosen += rng.sample(in_bin, min(per_bin, len(in_bin)))
    print(f"Tong so cap (khac ghi chu, cosine >= {BINS[0][0]}): {len(pairs)} / {len(rows)} chunk")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["score", "note_a", "heading_a", "text_a", "note_b", "heading_b", "text_b", "label"])
        for score, i, j in sorted(chosen, reverse=True):
            a, b = rows[i], rows[j]
            w.writerow([f"{score:.3f}", a["title"], a["heading"], a["text"][:300].replace("\n", " "),
                        b["title"], b["heading"], b["text"][:300].replace("\n", " "), ""])
    print(f"Da ghi {len(chosen)} cap vao {out}")


if __name__ == "__main__":
    main()
