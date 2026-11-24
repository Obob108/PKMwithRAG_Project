"""CSDL cho kiem thu: SQLite trong bo nho (mac dinh) hoac PostgreSQL that neu dat TEST_DATABASE_URL.

Chay bo test tren PostgreSQL (vd Docker: docker compose up -d db):
    $env:TEST_DATABASE_URL = "postgresql://pkm:pkm@127.0.0.1:5433/pkm_test"   (PowerShell)
    python -m pytest
Moi test nhan mot schema sach (xoa va tao lai schema public), nen KHONG tro bien nay vao CSDL that.
"""
import os

import pytest

from app.core.db import connect, init_db

TEST_PG = os.environ.get("TEST_DATABASE_URL", "")


def reset_pg(url: str) -> None:
    conn = connect(url)
    # Test truoc co the de lai ket noi dang giu khoa: ngat het roi moi xoa schema (neu khong se cho mai).
    conn.executescript(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE datname = current_database() AND pid <> pg_backend_pid();")
    conn.commit()
    conn.executescript("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    conn.commit()
    conn.close()


def fresh_conn():
    """Ket noi toi mot CSDL rong da co schema."""
    if TEST_PG:
        reset_pg(TEST_PG)
        conn = connect(TEST_PG)
    else:
        conn = connect(":memory:")
    init_db(conn)
    return conn


def database_url_for(tmp_path) -> str:
    """Gia tri DATABASE_URL cho Settings trong test API (PostgreSQL da xoa sach, hoac file SQLite tam)."""
    if TEST_PG:
        reset_pg(TEST_PG)
        return TEST_PG
    return ""


def integrity_errors() -> tuple:
    """Loai loi vi pham rang buoc (UNIQUE, khoa ngoai...) cua CSDL dang test."""
    import sqlite3

    errs: list = [sqlite3.IntegrityError]
    if TEST_PG:
        import psycopg

        errs.append(psycopg.IntegrityError)
    return tuple(errs)


def schema_version(conn) -> int:
    if getattr(conn, "is_postgres", False):
        return conn.execute("SELECT version FROM schema_meta").fetchone()[0]
    return conn.execute("PRAGMA user_version").fetchone()[0]


sqlite_only = pytest.mark.skipif(bool(TEST_PG), reason="kiem tra nang cap schema SQLite cu")
