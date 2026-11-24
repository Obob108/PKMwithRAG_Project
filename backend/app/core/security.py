"""Bam mat khau (argon2) va token JWT."""
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_token(user_id: int, secret: str, minutes: int, version: int = 0) -> str:
    """`ver` = users.token_version luc cap token; doi mat khau thi tang token_version nen token cu het hieu luc."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode({"sub": str(user_id), "ver": version, "exp": exp}, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> tuple[int, int] | None:
    """(user_id, token_version) neu token hop le; token cu chua co `ver` coi nhu ver = 0."""
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
        return int(claims["sub"]), int(claims.get("ver", 0))
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return None
