import threading

from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer

from ..core.db import connect
from ..core.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_conn(request: Request):
    """Mot ket noi SQLite rieng cho moi request."""
    conn = connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def current_user(request: Request, token: str = Depends(oauth2_scheme), conn=Depends(get_conn)) -> dict:
    user_id = decode_token(token, request.app.state.settings.jwt_secret)
    row = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone() if user_id else None
    if row is None:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập hoặc phiên đã hết hạn",
                            headers={"WWW-Authenticate": "Bearer"})
    return {"id": row["id"], "username": row["username"]}


def user_lock(app, user_id: int) -> threading.Lock:
    """Khoa theo user: chi mot tac vu lap chi muc / xoa vector chay cung luc cho moi user."""
    return app.state.locks.setdefault(user_id, threading.Lock())


def get_llm(request: Request):
    app = request.app
    if app.state.llm is None:
        s = app.state.settings
        if not s.gemini_api_key:
            raise HTTPException(status_code=503, detail="Chưa cấu hình GEMINI_API_KEY trên máy chủ")
        from ..services.llm import GeminiClient

        app.state.llm = GeminiClient(s.gemini_api_key, s.gemini_model)
    return app.state.llm
