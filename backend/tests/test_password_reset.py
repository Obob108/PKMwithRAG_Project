"""Ma OTP quen mat khau (khong can fastapi)."""
import pytest

from app.core.db import connect, init_db
from app.services import password_reset as svc
from tests.dbutil import fresh_conn, schema_version

SECRET = "test-secret"


@pytest.fixture
def conn():
    c = fresh_conn()
    c.execute("INSERT INTO users(username, email, password_hash) VALUES ('alice', 'alice@gmail.com', 'x')")
    c.commit()
    yield c
    c.close()


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def test_schema_has_token_version_and_reset_table(conn):
    assert conn.execute("SELECT token_version FROM users WHERE id = 1").fetchone()[0] == 0
    assert schema_version(conn) >= 8


def test_code_is_six_digits_and_only_hash_is_stored(conn):
    code = svc.issue_code(conn, 1, SECRET)
    assert len(code) == 6 and code.isdigit()
    stored = conn.execute("SELECT code_hash FROM password_resets WHERE user_id = 1").fetchone()[0]
    assert code not in stored and len(stored) == 64


def test_correct_code_works_once(conn):
    code = svc.issue_code(conn, 1, SECRET)
    assert svc.verify_code(conn, 1, f" {code} ", SECRET)
    assert not svc.verify_code(conn, 1, code, SECRET)  # da dung
    assert conn.execute("SELECT COUNT(*) FROM password_resets").fetchone()[0] == 0


def test_wrong_code_counts_attempts_then_invalidates(conn):
    code = svc.issue_code(conn, 1, SECRET)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(4):
        assert not svc.verify_code(conn, 1, wrong, SECRET, max_attempts=5)
    assert conn.execute("SELECT attempts FROM password_resets").fetchone()[0] == 4
    assert not svc.verify_code(conn, 1, wrong, SECRET, max_attempts=5)  # lan thu 5: xoa ma
    assert not svc.verify_code(conn, 1, code, SECRET, max_attempts=5)   # ma dung cung vo hieu


def test_expired_code_rejected(conn):
    clock = Clock()
    code = svc.issue_code(conn, 1, SECRET, ttl_seconds=600, now=clock)
    clock.t += 601
    assert not svc.verify_code(conn, 1, code, SECRET, now=clock)


def test_new_code_replaces_old_and_resets_attempts(conn):
    old = svc.issue_code(conn, 1, SECRET)
    svc.verify_code(conn, 1, "abc", SECRET)
    new = svc.issue_code(conn, 1, SECRET)
    assert conn.execute("SELECT attempts FROM password_resets").fetchone()[0] == 0
    if old != new:
        assert not svc.verify_code(conn, 1, old, SECRET)
        new = svc.issue_code(conn, 1, SECRET)
    assert svc.verify_code(conn, 1, new, SECRET)


def test_code_bound_to_user_and_secret(conn):
    conn.execute("INSERT INTO users(username, email, password_hash) VALUES ('bob', 'bob@gmail.com', 'x')")
    code = svc.issue_code(conn, 1, SECRET)
    assert not svc.verify_code(conn, 2, code, SECRET)  # bob khong co ma
    assert not svc.verify_code(conn, 1, code, "secret-khac")


def test_garbage_input_rejected(conn):
    svc.issue_code(conn, 1, SECRET)
    for bad in ("", "12345", "1234567", "abcdef", None):
        assert not svc.verify_code(conn, 1, bad, SECRET, max_attempts=99)


def test_deleting_user_deletes_code(conn):
    svc.issue_code(conn, 1, SECRET)
    conn.execute("DELETE FROM users WHERE id = 1")
    assert conn.execute("SELECT COUNT(*) FROM password_resets").fetchone()[0] == 0
