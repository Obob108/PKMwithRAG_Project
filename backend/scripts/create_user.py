"""Tao tai khoan: python scripts/create_user.py <username>   (chay tu thu muc backend)"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argon2 import PasswordHasher  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("username")
    args = parser.parse_args()

    password = getpass.getpass("Mat khau: ")
    if len(password) < 6 or password != getpass.getpass("Nhap lai: "):
        sys.exit("Mat khau qua ngan hoac khong khop.")

    conn = connect(get_settings().db_path)
    init_db(conn)
    try:
        conn.execute(
            "INSERT INTO users(username, password_hash) VALUES (?, ?)",
            (args.username, PasswordHasher().hash(password)),
        )
        conn.commit()
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Khong tao duoc user: {exc}")
    print(f"Da tao user '{args.username}'.")


if __name__ == "__main__":
    main()
