"""Khoa lap chi muc theo nguoi dung."""
import threading
from contextlib import contextmanager

INDEX_LOCK_CLASS = 7101  # nhom advisory lock "lap chi muc theo nguoi dung" (tranh trung khoa khac)


@contextmanager
def user_lock(app, user_id: int, conn=None):
    """Khoa theo user: chi mot tac vu lap chi muc / xoa vector chay cung luc cho moi user.

    Trong tien trinh: threading.Lock. PostgreSQL: them advisory lock tren CSDL, nen dung ca khi chay nhieu
    tien trinh / nhieu may (khoa trong RAM moi tien trinh mot ban, khong thay nhau). Khoa gan voi ket noi `conn`
    nen phai mo khoa trong finally truoc khi tra ket noi ve pool."""
    with app.state.locks.setdefault(user_id, threading.Lock()):
        pg = conn is not None and getattr(conn, "is_postgres", False)
        if pg:
            conn.execute("SELECT pg_advisory_lock(CAST(? AS integer), CAST(? AS integer))", (INDEX_LOCK_CLASS, int(user_id)))
        try:
            yield
        finally:
            if pg:
                conn.rollback()  # khong de giao dich do dang giu khoa hang
                conn.execute("SELECT pg_advisory_unlock(CAST(? AS integer), CAST(? AS integer))", (INDEX_LOCK_CLASS, int(user_id)))
                conn.commit()
