"""In bac (so canh semantic) cua tung ghi chu: python scripts/link_degree.py --user alice"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.graph_stats import note_degrees  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user", required=True)
    args = p.parse_args()
    conn = connect(get_settings().db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'.")
    rows = note_degrees(conn, user["id"])
    total_edges = conn.execute(
        "SELECT COUNT(*) FROM links WHERE user_id = ? AND type = 'semantic'", (user["id"],)).fetchone()[0]
    total_chunks = sum(r["chunks"] for r in rows)
    print(f"{len(rows)} ghi chu, {total_chunks} chunk, {total_edges} canh semantic "
          f"({total_edges / max(total_chunks, 1):.2f} canh/chunk)\n")
    print(f"{'ghi chu':<40}{'chunk':>6}{'canh':>6}{'canh/chunk':>12}{'diem TB':>9}")
    for r in rows:
        print(f"{r['title']:<40}{r['chunks']:>6}{r['edges']:>6}{r['edges_per_chunk']:>12.1f}{r['avg_score']:>9.2f}")


if __name__ == "__main__":
    main()
