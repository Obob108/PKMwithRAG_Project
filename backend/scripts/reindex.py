"""Lap chi muc lai TOAN BO ghi chu cua mot user (vd sau khi doi cach chunk/embedding).

Dung backend (uvicorn) truoc khi chay. Chay tu thu muc backend:
    python scripts/reindex.py --user hoanglong
Chay hai luot: luot 1 tinh lai vector moi ghi chu, luot 2 tinh lai lien ket ngu nghia tren cac vector moi
(o luot 1, ghi chu dau tien con so voi vector cu cua ghi chu chua kip lap lai).
Quyet dinh ✓/✗ cua nguoi dung duoc giu nguyen.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import Database  # noqa: E402
from app.services.embedding import Embedder  # noqa: E402
from app.services.indexer import index_note  # noqa: E402
from app.services.vector_store import make_vector_stores  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    args = parser.parse_args()

    s = get_settings()
    db = Database(s.database)
    db.init()
    stores = make_vector_stores(s, db)
    ensure = getattr(stores, "ensure_schema", None)
    if ensure:
        ensure()
    embedder = Embedder(s.embedding_model)
    with db.connection() as conn:
        user = conn.execute("SELECT id FROM users WHERE lower(username) = lower(?)", (args.user,)).fetchone()
        if user is None:
            sys.exit(f"Khong co user '{args.user}'")
        ids = [r["id"] for r in conn.execute("SELECT id FROM notes WHERE user_id = ? ORDER BY id", (user["id"],))]
        for rnd in (1, 2):
            failed = 0
            for i, nid in enumerate(ids, 1):
                t = time.time()
                st = index_note(conn, stores, embedder, nid, link_top_k=s.link_top_k,
                                link_threshold=s.link_threshold, force=True)
                failed += st != "ready"
                print(f"luot {rnd} [{i}/{len(ids)}] ghi chu {nid}: {st} ({time.time() - t:.1f}s)")
            print(f"Xong luot {rnd}: {len(ids) - failed} ok, {failed} loi")
    db.close()


if __name__ == "__main__":
    main()
