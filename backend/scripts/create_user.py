"""Tao tai khoan: python scripts/create_user.py <username> [--email ten@gmail.com] [--admin]   (chay tu thu muc backend)"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argon2 import PasswordHasher  # noqa: E402

from app.api.routes import normalize_gmail  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("username")
    parser.add_argument("--email", help="Gmail cua tai khoan (dung cho quen mat khau)")
    parser.add_argument("--admin", action="store_true", help="tao tai khoan quan tri")
    args = parser.parse_args()
    email = None
    if args.email:
        email = normalize_gmail(args.email)
        if email is None:
            sys.exit("Email phai dung dinh dang Gmail.")

    password = getpass.getpass("Mat khau: ")
    if len(password) < 6 or password != getpass.getpass("Nhap lai: "):
        sys.exit("Mat khau qua ngan hoac khong khop.")

    conn = connect(get_settings().database)
    init_db(conn)
    try:
        conn.execute(
            "INSERT INTO users(username, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (args.username, email, PasswordHasher().hash(password), "admin" if args.admin else "user"),
        )
        conn.commit()
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Khong tao duoc user: {exc}")
    print(f"Da tao {'admin' if args.admin else 'user'} '{args.username}'.")


if __name__ == "__main__":
    main()
