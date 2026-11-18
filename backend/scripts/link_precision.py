"""Precision cua goi y lien ket theo nguong tau, dung nhan ✓/✗ nguoi dung bam trong panel "Lien ket".

    python scripts/link_precision.py --user alice [--out ../eval/link_decisions.csv]

Moi cap ghi chu da duoc chap nhan (dung) hoac bo qua (sai) kem diem cosine cao nhat cua cap luc quyet
dinh. Voi moi tau: precision = so cap chap nhan / so cap da gan nhan co diem >= tau.
Luu y: chi do duoc tau >= link_threshold luc lap chi muc, vi cap duoi nguong khong bao gio duoc goi y;
va day la precision theo CAP GHI CHU (khac link_sample.csv cua sample_links.py, gan nhan theo cap chunk).
"""
import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.notes import link_decisions, precision_by_threshold  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user", required=True)
    p.add_argument("--out", default=None, help="ghi danh sach cap da gan nhan ra CSV (utf-8-sig)")
    p.add_argument("--step", type=float, default=0.05)
    args = p.parse_args()

    s = get_settings()
    conn = connect(s.db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'.")
    rows = link_decisions(conn, user["id"])
    if not rows:
        sys.exit("Chua co cap nao duoc chap nhan/bo qua. Bam ✓ / ✗ trong panel 'Lien ket' truoc.")

    lo = s.link_threshold
    taus = []
    t = lo
    while t < 1.0 + 1e-9:
        taus.append(round(t, 3))
        t += args.step
    acc = sum(1 for r in rows if r["status"] == "accepted")
    print(f"{len(rows)} cap da gan nhan: {acc} chap nhan, {len(rows) - acc} bo qua "
          f"(nguong lap chi muc hien tai = {lo})\n")
    print(f"{'tau':>6}{'so cap':>8}{'dung':>6}{'sai':>6}{'precision':>11}")
    for r in precision_by_threshold(rows, taus):
        prec = "-" if r["precision"] is None else f"{r['precision']:.2f}"
        print(f"{r['tau']:>6.2f}{r['labeled']:>8}{r['accepted']:>6}{r['rejected']:>6}{prec:>11}")

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["score", "note_a", "note_b", "label", "status", "decided_at"])
            for r in rows:
                w.writerow([f"{r['score']:.3f}", r["title_a"], r["title_b"],
                            1 if r["status"] == "accepted" else 0, r["status"], r["decided_at"]])
        print(f"\nDa ghi {len(rows)} cap vao {out}")


if __name__ == "__main__":
    main()
