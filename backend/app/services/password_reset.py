"""Quen mat khau bang ma OTP gui qua email.

Luong:
  1. issue_code: sinh ma 6 so ngau nhien (secrets), chi luu BAM HMAC-SHA256 cua ma (khoa = JWT_SECRET),
     het han sau ttl giay. Moi tai khoan chi co mot ma con hieu luc: xin ma moi thi ma cu mat tac dung.
  2. verify_code: dung, chua het han, chua vuot so lan thu -> True va XOA ma (chi dung mot lan).
     Sai -> tang so lan thu; du max_attempts thi xoa ma (phai xin ma moi).

Vi sao HMAC ma khong argon2: ma chi song 10 phut va chi duoc thu toi da 5 lan, nen khong the do vet can
truc tuyen; HMAC co khoa giu cho ai doc duoc CSDL cung khong suy nguoc duoc ma neu khong co JWT_SECRET.
Cau lenh INSERT ... ON CONFLICT chay duoc tren ca SQLite (>= 3.24) lan PostgreSQL.
"""
import hashlib
import hmac
import secrets
import time

CODE_DIGITS = 6


def _hash(secret: str, user_id: int, code: str) -> str:
    return hmac.new(secret.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


def new_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"


def issue_code(conn, user_id: int, secret: str, *, ttl_seconds: int = 600, now=time.time) -> str:
    """Tao (hoac thay) ma OTP cho tai khoan, tra ve ma dang chu de gui email. Khong luu ma goc."""
    code = new_code()
    conn.execute(
        "INSERT INTO password_resets(user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) "
        "ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, "
        "expires_at = excluded.expires_at, attempts = 0",
        (user_id, _hash(secret, user_id, code), now() + ttl_seconds),
    )
    conn.commit()
    return code


def verify_code(conn, user_id: int, code: str, secret: str, *, max_attempts: int = 5, now=time.time) -> bool:
    """True neu ma dung va con hieu luc (ma bi xoa ngay, khong dung lai duoc)."""
    row = conn.execute(
        "SELECT code_hash, expires_at, attempts FROM password_resets WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return False
    if row["expires_at"] < now() or row["attempts"] >= max_attempts:
        conn.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
        conn.commit()
        return False
    code = (code or "").strip()
    ok = len(code) == CODE_DIGITS and code.isdigit() and hmac.compare_digest(
        row["code_hash"], _hash(secret, user_id, code))
    if ok or row["attempts"] + 1 >= max_attempts:
        conn.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
    else:
        conn.execute("UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    return ok
