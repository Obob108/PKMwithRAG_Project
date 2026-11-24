"""Tim (va xoa) anh dinh kem khong con ghi chu nao dung.

    python scripts/cleanup_attachments.py            # chi liet ke, khong xoa gi
    python scripts/cleanup_attachments.py --apply    # xoa that (dong trong CSDL + file trong uploads/)
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services import attachments  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="xoa that (mac dinh chi liet ke)")
    args = ap.parse_args()
    s = get_settings()
    conn = connect(s.database)
    init_db(conn)
    found = attachments.delete_orphans(conn, s.upload_dir) if args.apply else attachments.orphans(conn)
    for a in found:
        print(f"user {a['user_id']:>3}  {a['size'] / 1024:8.1f} KB  {a['name']}")
    total = sum(a["size"] for a in found) / 1024 / 1024
    verb = "Da xoa" if args.apply else "Tim thay (chua xoa, them --apply de xoa)"
    print(f"{verb}: {len(found)} anh, {total:.2f} MB")


if __name__ == "__main__":
    main()
