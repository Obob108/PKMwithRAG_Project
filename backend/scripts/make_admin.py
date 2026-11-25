"""Cap / thu quyen quan tri cho tai khoan da co (chay tu thu muc backend):

    python scripts/make_admin.py <username>            # thanh admin
    python scripts/make_admin.py <username> --revoke   # tro lai nguoi dung thuong

Khong co API nao tu cap quyen admin: chi nguoi co quyen vao may chu (chay script nay) moi lam duoc.
Sau khi doi quyen, nguoi do dang xuat roi dang nhap lai de giao dien chuyen sang trang quan tri.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("username")
    parser.add_argument("--revoke", action="store_true", help="thu quyen admin")
    args = parser.parse_args()

    conn = connect(get_settings().database)
    init_db(conn)  # dam bao da co cot role (schema v9)
    role = "user" if args.revoke else "admin"
    cur = conn.execute("UPDATE users SET role = ?, is_active = 1 WHERE username = ?", (role, args.username))
    conn.commit()
    if cur.rowcount == 0:
        sys.exit(f"Khong co tai khoan '{args.username}'.")
    print(f"'{args.username}' gio la {role}.")


if __name__ == "__main__":
    main()
