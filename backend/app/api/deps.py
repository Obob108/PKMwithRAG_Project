import threading

from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer

from ..core.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_conn(request: Request):
    """Ket noi cho mot request: muon tu connection pool (PostgreSQL) hoac mo moi (SQLite), tra lai khi xong."""
    with request.app.state.db.connection() as conn:
        yield conn


def _user_from_token(conn, request: Request, token: str) -> dict:
    decoded = decode_token(token, request.app.state.settings.jwt_secret)
    row = conn.execute("SELECT id, username, token_version FROM users WHERE id = ?",
                       (decoded[0],)).fetchone() if decoded else None
    # token cap truoc lan doi mat khau gan nhat (token_version da tang) -> bi tu choi
    if row is None or row["token_version"] != decoded[1]:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập hoặc phiên đã hết hạn",
                            headers={"WWW-Authenticate": "Bearer"})
    return {"id": row["id"], "username": row["username"]}


def current_user(request: Request, token: str = Depends(oauth2_scheme), conn=Depends(get_conn)) -> dict:
    return _user_from_token(conn, request, token)


def current_user_brief(request: Request, token: str = Depends(oauth2_scheme)) -> dict:
    """Nhu current_user nhung chi muon ket noi trong luc kiem tra token roi tra ngay. Dung cho luong SSE
    song hang phut: neu giu ket noi ca luong thi vai chuc thiet bi la can connection pool."""
    with request.app.state.db.connection() as conn:
        return _user_from_token(conn, request, token)


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

        app.state.llm = GeminiClient(s.gemini_api_key, s.gemini_model, fallbacks=s.gemini_fallbacks)
    return app.state.llm
