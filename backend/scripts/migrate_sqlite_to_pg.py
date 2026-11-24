"""Chep toan bo du lieu tu SQLite (+ vector FAISS) sang PostgreSQL (+ pgvector).

    python scripts/migrate_sqlite_to_pg.py --pg postgresql://pkm:pkm@localhost:5432/pkm
    python scripts/migrate_sqlite_to_pg.py --pg ... --sqlite ../data/app.db --faiss-dir ../data/faiss --no-vectors

- Giu nguyen moi id (ghi chu, chunk, su kien...) nen lien ket, phien ban, con tro dong bo cua thiet bi van dung.
- CSDL dich phai RONG (script tu tao schema); co du lieu thi dung lai, tru khi dung --force (xoa sach truoc).
- Vector: doc tu file FAISS cua tung nguoi dung (reconstruct theo chunk id) va ghi vao cot chunks.embedding.
  --no-vectors: bo qua (dung khi chay PostgreSQL + FAISS, VECTOR_BACKEND=faiss).
- Toan bo nam trong MOT giao dich: loi giua chung thi khong ghi gi.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import connect, init_db  # noqa: E402

# Thu tu theo khoa ngoai: bang duoc tham chieu chep truoc.
TABLES = ["users", "folders", "notes", "note_versions", "chunks", "links", "link_decisions", "messages",
          "events", "attachments", "password_resets"]
IDENTITY_TABLES = ["users", "folders", "notes", "chunks", "links", "messages", "events", "attachments"]


def copy_table(src: sqlite3.Connection, dst, table: str, dst_cols: set[str]) -> int:
    if not src.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone():
        return 0
    cols = [r[1] for r in src.execute(f"PRAGMA table_info({table})") if r[1] in dst_cols]
    rows = src.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    for r in rows:
        dst.execute(sql, tuple(r))
    return len(rows)


def pg_columns(dst, table: str) -> set[str]:
    return {r[0] for r in dst.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = ?", (table,)).fetchall()}


def _defaults() -> tuple[str, str, str]:
    """(DATABASE_URL, file SQLite, thu muc FAISS) theo backend/.env."""
    try:
        from app.core.config import get_settings
    except ImportError:  # thieu pydantic-settings: dung mac dinh
        return "", "../data/app.db", "../data/faiss"
    s = get_settings()
    return s.database_url, str(s.db_path), str(s.faiss_dir)


def main() -> None:
    pg_default, sqlite_default, faiss_default = _defaults()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg", default=pg_default, help="postgresql://... (mac dinh: DATABASE_URL trong .env)")
    ap.add_argument("--sqlite", default=sqlite_default)
    ap.add_argument("--faiss-dir", default=faiss_default)
    ap.add_argument("--no-vectors", action="store_true")
    ap.add_argument("--force", action="store_true", help="xoa du lieu dang co trong CSDL dich truoc khi chep")
    args = ap.parse_args()
    if not args.pg.startswith(("postgresql://", "postgres://")):
        sys.exit("Can --pg postgresql://... (hoac DATABASE_URL trong .env)")
    if not Path(args.sqlite).exists():
        sys.exit(f"Khong thay file SQLite: {args.sqlite}")

    src = sqlite3.connect(args.sqlite)
    init_db(src)  # dua file cu len schema moi nhat truoc khi chep
    dst = connect(args.pg)
    init_db(dst)
    if dst.execute("SELECT EXISTS (SELECT 1 FROM users)").fetchone()[0]:
        if not args.force:
            sys.exit("CSDL dich da co du lieu. Dung --force de xoa sach va chep lai.")
        dst.execute("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY CASCADE")

    try:
        for t in TABLES:
            print(f"{t:16s} {copy_table(src, dst, t, pg_columns(dst, t)):6d} dong")
        for t in IDENTITY_TABLES:  # id tu tang tiep tu gia tri lon nhat, khong dung lai id cu
            dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {t}), 0) + 1, false)")
        if not args.no_vectors:
            copy_vectors(src, dst, Path(args.faiss_dir))
        dst.commit()
    except Exception:
        dst.rollback()
        raise
    print("Xong. Dat DATABASE_URL trong backend/.env roi khoi dong lai backend.")


def copy_vectors(src: sqlite3.Connection, dst, faiss_dir: Path) -> None:
    import faiss

    from app.services.pg_vector_store import to_literal

    dst.execute("CREATE EXTENSION IF NOT EXISTS vector")
    dst.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(1024)")
    total = missing = 0
    for (user_id,) in src.execute("SELECT id FROM users").fetchall():
        path = faiss_dir / f"user_{user_id}.index"
        chunk_ids = [r[0] for r in src.execute("SELECT id FROM chunks WHERE user_id = ?", (user_id,))]
        if not chunk_ids:
            continue
        if not path.exists():
            missing += len(chunk_ids)
            continue
        index = faiss.read_index(str(path))
        for cid in chunk_ids:
            try:
                vec = index.reconstruct(int(cid))
            except Exception:  # noqa: BLE001  chunk khong co vector (lech FAISS / SQLite)
                missing += 1
                continue
            dst.execute("UPDATE chunks SET embedding = CAST(? AS vector) WHERE id = ?", (to_literal(vec), cid))
            total += 1
    print(f"vector           {total:6d} chunk" + (f" ({missing} chunk thieu vector: chay lai lap chi muc)" if missing else ""))


if __name__ == "__main__":
    main()
