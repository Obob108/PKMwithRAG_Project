import asyncio
import hmac
import json
import logging
import re
import time
import uuid
from pathlib import Path

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Query, Request,
                     Response, UploadFile)
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..core.db import connect
from ..core.security import create_token, hash_password, verify_password
from ..services import notes as notes_svc
from ..services.indexer import delete_note as delete_note_index
from ..services.indexer import index_note
from ..services.pdf import extract_pdf_markdown
from ..services.rag import answer_question
from ..services.retrieval import retrieve
from .deps import current_user, get_conn, get_llm, user_lock

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ schemas
class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=500_000)
    client_id: str | None = Field(default=None, max_length=64)


class NoteUpdate(BaseModel):
    content: str = Field(max_length=500_000)
    base_version: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=200)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = Field(default=None, max_length=128)


USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    use_graph: bool | None = None


# ------------------------------------------------------------------ helpers
def run_index(app, user_id: int, note_id: int) -> None:
    """Lap chi muc o nen, voi ket noi rieng; tuan tu theo tung user."""
    s = app.state.settings
    conn = connect(s.db_path)
    try:
        with user_lock(app, user_id):
            index_note(conn, app.state.stores, app.state.embedder, note_id,
                       link_top_k=s.link_top_k, link_threshold=s.link_threshold)
    except ValueError:
        pass  # ghi chu da bi xoa truoc khi kip lap chi muc
    except Exception:  # noqa: BLE001
        log.exception("Lap chi muc nen that bai (ghi chu %s)", note_id)
    finally:
        conn.close()


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Không tìm thấy ghi chú")


# ------------------------------------------------------------------ auth
def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _token_for(request: Request, user_id: int) -> dict:
    s = request.app.state.settings
    return {"access_token": create_token(user_id, s.jwt_secret, s.jwt_expire_minutes), "token_type": "bearer"}


@router.get("/config")
def public_config(request: Request):
    s = request.app.state.settings
    return {"allow_registration": s.allow_registration, "invite_required": bool(s.invite_code)}


@router.post("/auth/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), conn=Depends(get_conn)):
    limiter = request.app.state.login_limiter
    key = f"{_client_ip(request)}|{form.username.lower()}"
    if limiter.blocked(key):
        raise HTTPException(status_code=429, detail="Đăng nhập sai quá nhiều lần, thử lại sau vài phút")
    row = conn.execute("SELECT id, password_hash FROM users WHERE username = ?", (form.username,)).fetchone()
    if row is None or not verify_password(row["password_hash"], form.password):
        limiter.hit(key)
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    limiter.reset(key)
    return _token_for(request, row["id"])


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, request: Request, conn=Depends(get_conn)):
    s = request.app.state.settings
    if not s.allow_registration:
        raise HTTPException(status_code=403, detail="Máy chủ đang tắt đăng ký tài khoản mới")
    limiter = request.app.state.register_limiter
    key = _client_ip(request)
    if limiter.blocked(key):
        raise HTTPException(status_code=429, detail="Đăng ký quá nhiều lần, thử lại sau")
    if s.invite_code and not hmac.compare_digest((body.invite_code or "").encode(), s.invite_code.encode()):
        limiter.hit(key)
        raise HTTPException(status_code=403, detail="Mã mời không đúng")
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=422, detail="Tên đăng nhập chỉ gồm chữ không dấu, số, _ . -")
    if conn.execute("SELECT 1 FROM users WHERE lower(username) = lower(?)", (username,)).fetchone():
        raise HTTPException(status_code=409, detail="Tên đăng nhập đã tồn tại")
    cur = conn.execute("INSERT INTO users(username, password_hash) VALUES (?, ?)",
                       (username, hash_password(body.password)))
    conn.commit()
    limiter.hit(key)
    return _token_for(request, cur.lastrowid)


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user


# ------------------------------------------------------------------ notes
@router.get("/notes")
def list_notes(full: bool = Query(False), user: dict = Depends(current_user), conn=Depends(get_conn)):
    return notes_svc.list_notes(conn, user["id"], with_content=full)


@router.post("/notes", status_code=201)
def create_note(body: NoteCreate, request: Request, background: BackgroundTasks,
                user: dict = Depends(current_user), conn=Depends(get_conn),
                x_device_id: str | None = Header(default=None)):
    note = notes_svc.create_note(conn, user["id"], body.title, body.content,
                                 client_id=body.client_id, device_id=x_device_id)
    background.add_task(run_index, request.app, user["id"], note["id"])
    return note


@router.post("/notes/upload", status_code=201)
def upload_note(request: Request, background: BackgroundTasks, file: UploadFile = File(...),
                user: dict = Depends(current_user), conn=Depends(get_conn),
                x_device_id: str | None = Header(default=None)):
    s = request.app.state.settings
    name = file.filename or ""
    suffix = Path(name).suffix.lower()
    if suffix not in (".md", ".txt", ".pdf"):
        raise HTTPException(status_code=415, detail="Chỉ hỗ trợ file .md, .txt hoặc .pdf")
    limit = s.max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File lớn hơn {s.max_upload_mb} MB")
    title = Path(name).stem[:200] or "Tài liệu"
    file_path = file_name = None
    if suffix == ".pdf":
        folder = s.upload_dir / str(user["id"])
        folder.mkdir(parents=True, exist_ok=True)
        stored = f"{uuid.uuid4().hex}.pdf"  # ten do he thong dat, khong dung ten file tu client
        path = folder / stored
        path.write_bytes(data)
        try:
            content = extract_pdf_markdown(path)
            if not content.strip():
                raise HTTPException(status_code=422, detail="PDF không có lớp văn bản (có thể là bản scan)")
        except HTTPException:
            path.unlink(missing_ok=True)
            raise
        except Exception:  # noqa: BLE001
            path.unlink(missing_ok=True)
            log.exception("Khong doc duoc PDF")
            raise HTTPException(status_code=422, detail="Không đọc được file PDF")
        source, file_path, file_name = "pdf", f"{user['id']}/{stored}", Path(name).name[:200]
    else:
        content, source = data.decode("utf-8", errors="replace"), "md"
    try:
        note = notes_svc.create_note(conn, user["id"], title, content, source=source, device_id=x_device_id,
                                     file_path=file_path, file_name=file_name)
    except Exception:
        if file_path:
            (s.upload_dir / file_path).unlink(missing_ok=True)
        raise
    background.add_task(run_index, request.app, user["id"], note["id"])
    return note


@router.get("/notes/{note_id}/file")
def get_note_file(note_id: int, request: Request, user: dict = Depends(current_user), conn=Depends(get_conn)):
    """PDF goc cua ghi chu (chi chu so huu)."""
    try:
        found = notes_svc.get_file(conn, user["id"], note_id, request.app.state.settings.upload_dir)
    except notes_svc.NotFound:
        raise _not_found()
    if found is None:
        raise HTTPException(status_code=404, detail="Ghi chú này không có file gốc")
    path, name = found
    return FileResponse(path, media_type="application/pdf", filename=name, content_disposition_type="inline")


@router.get("/notes/{note_id}")
def get_note(note_id: int, user: dict = Depends(current_user), conn=Depends(get_conn)):
    try:
        return notes_svc.get_note(conn, user["id"], note_id)
    except notes_svc.NotFound:
        raise _not_found()


@router.put("/notes/{note_id}")
def update_note(note_id: int, body: NoteUpdate, request: Request, background: BackgroundTasks,
                user: dict = Depends(current_user), conn=Depends(get_conn),
                x_device_id: str | None = Header(default=None)):
    try:
        out = notes_svc.update_note(conn, user["id"], note_id, content=body.content,
                                    base_version=body.base_version, title=body.title, device_id=x_device_id)
    except notes_svc.NotFound:
        raise _not_found()
    except notes_svc.BadVersion:
        raise HTTPException(status_code=409, detail="base_version không hợp lệ (lớn hơn phiên bản hiện tại)")
    except notes_svc.TitleTaken:
        raise HTTPException(status_code=409, detail="Đã có ghi chú khác dùng tiêu đề này")
    if out["changed"]:
        background.add_task(run_index, request.app, user["id"], note_id)
    return {"result": out["result"], "note": out["note"]}


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, request: Request, user: dict = Depends(current_user), conn=Depends(get_conn),
                x_device_id: str | None = Header(default=None)):
    try:
        notes_svc.get_note(conn, user["id"], note_id)  # kiem tra quyen so huu truoc khi xoa vector
    except notes_svc.NotFound:
        raise _not_found()
    with user_lock(request.app, user["id"]):
        delete_note_index(conn, request.app.state.stores, note_id, device_id=x_device_id,
                          upload_dir=request.app.state.settings.upload_dir)
    return Response(status_code=204)


@router.get("/notes/{note_id}/related")
def related(note_id: int, limit: int = Query(10, ge=1, le=50),
            user: dict = Depends(current_user), conn=Depends(get_conn)):
    try:
        return notes_svc.related_notes(conn, user["id"], note_id, limit)
    except notes_svc.NotFound:
        raise _not_found()


@router.get("/graph")
def graph(min_score: float = Query(0.0, ge=0.0, le=1.0), user: dict = Depends(current_user),
          conn=Depends(get_conn)):
    return notes_svc.graph(conn, user["id"], min_score)


# ------------------------------------------------------------------ search / chat
@router.get("/search")
def search(request: Request, q: str = Query(..., min_length=1, max_length=500), limit: int = Query(5, ge=1, le=20),
           user: dict = Depends(current_user), conn=Depends(get_conn)):
    st = request.app.state
    hits = retrieve(conn, st.stores.get(user["id"]), st.embedder, user["id"], q,
                    top_k=limit, context_k=limit, use_graph=False)
    return [{"note_id": h.note_id, "chunk_id": h.chunk_id, "title": h.title, "heading": h.heading,
             "snippet": h.text[:200], "score": round(h.vector_score, 3)} for h in hits]


@router.post("/chat")
def chat(body: ChatRequest, request: Request, user: dict = Depends(current_user), conn=Depends(get_conn)):
    st = request.app.state
    s = st.settings
    llm = get_llm(request)
    use_graph = s.chat_use_graph if body.use_graph is None else body.use_graph
    try:
        out = answer_question(conn, st.stores.get(user["id"]), st.embedder, llm, user["id"], body.question,
                              top_k=s.retrieve_top_k, context_k=s.context_top_k, rrf_k=s.rrf_k,
                              use_graph=use_graph, graph_mode="supplement", graph_slots=s.chat_graph_slots)
    except Exception:  # noqa: BLE001
        log.exception("Loi khi hoi dap")
        raise HTTPException(status_code=502, detail="Không gọi được mô hình ngôn ngữ. Thử lại sau.")
    return {"answer": out["answer"], "sources": out["sources"]}


# ------------------------------------------------------------------ dong bo
@router.get("/sync/changes")
def sync_changes(since: int | None = Query(default=None, ge=0), user: dict = Depends(current_user),
                 conn=Depends(get_conn)):
    """Khong co `since`: tra ve con tro hien tai (de bat dau). Co `since`: cac su kien sau do."""
    if since is None:
        return {"cursor": notes_svc.latest_event_id(conn, user["id"]), "events": []}
    events = notes_svc.changes_since(conn, user["id"], since)
    return {"cursor": events[-1]["id"] if events else since, "events": events}


def _latest(db_path, user_id: int) -> int:
    conn = connect(db_path)
    try:
        return notes_svc.latest_event_id(conn, user_id)
    finally:
        conn.close()


def _poll(db_path, user_id: int, cursor: int) -> list[dict]:
    conn = connect(db_path)
    try:
        return notes_svc.changes_since(conn, user_id, cursor)
    finally:
        conn.close()


@router.get("/events")
async def events(request: Request, since: int | None = Query(default=None, ge=0),
                 max_seconds: int | None = Query(default=None, ge=1, le=3600),
                 user: dict = Depends(current_user)):
    """Server-Sent Events: day su kien thay doi ghi chu. Client dung fetch co header Authorization
    (EventSource khong gui duoc header), tu noi lai kem `since` = id su kien cuoi da nhan."""
    s = request.app.state.settings
    user_id = user["id"]

    async def stream():
        cursor = since if since is not None else await run_in_threadpool(_latest, s.db_path, user_id)
        deadline = time.monotonic() + (max_seconds or s.sse_max_seconds)
        idle = 0
        yield "retry: 3000\n\n"
        while time.monotonic() < deadline:
            if await request.is_disconnected():
                break
            batch = await run_in_threadpool(_poll, s.db_path, user_id, cursor)
            for e in batch:
                cursor = e["id"]
                yield f"id: {e['id']}\nevent: note\ndata: {json.dumps(e)}\n\n"
            idle = 0 if batch else idle + 1
            if idle and idle % 15 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
