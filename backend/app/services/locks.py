"""Khoa lap chi muc theo nguoi dung (chi mot tac vu lap chi muc / xoa vector chay cung luc moi nguoi dung).

Thu tu dung: user_lock (trong tien trinh) -> muon ket noi -> pg_user_lock (giua cac tien trinh).
Cho khoa trong tien trinh TRUOC khi muon ket noi: tac vu dang xep hang khong om ket noi cua pool. Neu muon ket noi
truoc roi moi cho, luu nhieu ghi chu cung luc la vai chuc tac vu nen om het pool trong khi chi mot tac vu chay.
"""
import threading
from contextlib import contextmanager

INDEX_LOCK_CLASS = 7101  # nhom advisory lock "lap chi muc theo nguoi dung" (tranh trung khoa khac)


def user_lock(app, user_id: int) -> threading.Lock:
    """Khoa trong tien trinh (khong can ket noi CSDL)."""
    return app.state.locks.setdefault(user_id, threading.Lock())


@contextmanager
def pg_user_lock(conn, user_id: int):
    """PostgreSQL: advisory lock tren CSDL, dung ca khi chay nhieu tien trinh / nhieu may (khoa trong RAM moi
    tien trinh mot ban). Gan voi ket noi `conn` nen mo khoa trong finally truoc khi tra ket noi ve pool.
    SQLite: khong lam gi (mot tien trinh, user_lock la du)."""
    pg = conn is not None and getattr(conn, "is_postgres", False)
    if pg:
        conn.execute("SELECT pg_advisory_lock(CAST(? AS integer), CAST(? AS integer))", (INDEX_LOCK_CLASS, int(user_id)))
    try:
        yield
    finally:
        if pg:
            conn.rollback()  # khong de giao dich do dang giu khoa hang
            conn.execute("SELECT pg_advisory_unlock(CAST(? AS integer), CAST(? AS integer))",
                         (INDEX_LOCK_CLASS, int(user_id)))
            conn.commit()
