import asyncio
import hmac
import json
import logging
import re
import time
import uuid
from pathlib import Path

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Request,
                     Response, UploadFile)
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from typing import Literal

from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..core import captcha
from ..core.security import create_token, hash_password, verify_password
from ..services import attachments as att_svc
from ..services import notes as notes_svc
from ..services import password_reset as reset_svc
from ..services.mailer import reset_email
from ..services.indexer import delete_note as delete_note_index
from ..services.indexer import index_note
from ..services.llm import LLMBusy
from ..services.pdf import extract_pdf_markdown
from ..services.rag import answer_question
from ..services.retrieval import retrieve
from .deps import current_user, current_user_brief, get_conn, get_llm, user_lock

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ schemas
class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=500_000)
    client_id: str | None = Field(default=None, max_length=64)
    folder_id: int | None = None


class NoteUpdate(BaseModel):
    content: str = Field(max_length=500_000)
    base_version: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=200)
    # Chi gui khi doi thu muc; gui null = dua ghi chu ra ngoai. Khong gui = giu nguyen.
    folder_id: int | None = None


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=11, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = Field(default=None, max_length=128)
    captcha_token: str | None = Field(default=None, max_length=8192)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    captcha_token: str | None = Field(default=None, max_length=8192)


class ResetPasswordRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    code: str = Field(min_length=1, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)
    captcha_token: str | None = Field(default=None, max_length=8192)


USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
# Chi nhan dia chi Gmail: phan ten 1-64 ky tu (chu, so, . _ + -), khong bat dau/ket thuc bang dau cham.
GMAIL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@gmail\.com$")


def normalize_gmail(raw: str) -> str | None:
    """Tra ve email da chuan hoa (chu thuong, bo khoang trang) neu dung dinh dang Gmail, nguoc lai None."""
    email = raw.strip().lower()
    return email if GMAIL_RE.match(email) and ".." not in email else None


class LinkStatusUpdate(BaseModel):
    # 'suggested' = hoan tac (bo quyet dinh, quay ve goi y)
    status: Literal["accepted", "rejected", "suggested"]


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    use_graph: bool | None = None


# ------------------------------------------------------------------ helpers
def run_index(app, user_id: int, note_id: int) -> None:
    """Lap chi muc o nen, voi ket noi rieng; tuan tu theo tung user."""
    s = app.state.settings
    try:
        with user_lock(app, user_id), app.state.db.connection() as conn:
            index_note(conn, app.state.stores, app.state.embedder, note_id,
                       link_top_k=s.link_top_k, link_threshold=s.link_threshold)
    except ValueError:
        pass  # ghi chu da bi xoa truoc khi kip lap chi muc
    except Exception:  # noqa: BLE001
        log.exception("Lap chi muc nen that bai (ghi chu %s)", note_id)


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Không tìm thấy ghi chú")


# ------------------------------------------------------------------ auth
def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_captcha(request: Request, token: str | None) -> None:
    """Khi bat hCaptcha: token phai hop le (xac minh voi may chu hCaptcha), neu khong tra 400."""
    s = request.app.state.settings
    if not s.captcha_enabled:
        return
    if not token or not captcha.verify_hcaptcha(s.hcaptcha_secret, token, s.hcaptcha_sitekey):
        raise HTTPException(status_code=400, detail="Vui lòng hoàn thành captcha")


def _token_for(request: Request, user_id: int, version: int = 0) -> dict:
    s = request.app.state.settings
    return {"access_token": create_token(user_id, s.jwt_secret, s.jwt_expire_minutes, version),
            "token_type": "bearer"}


@router.get("/config")
def public_config(request: Request):
    s = request.app.state.settings
    return {"allow_registration": s.allow_registration, "invite_required": bool(s.invite_code),
            "hcaptcha_sitekey": s.hcaptcha_sitekey if s.captcha_enabled else None}


@router.post("/auth/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(),
          captcha_token: str | None = Form(default=None), conn=Depends(get_conn)):
    limiter = request.app.state.login_limiter
    key = f"{_client_ip(request)}|{form.username.lower()}"
    if limiter.blocked(key):
        raise HTTPException(status_code=429, detail="Đăng nhập sai quá nhiều lần, thử lại sau vài phút")
    _check_captcha(request, captcha_token)
    row = conn.execute("SELECT id, password_hash, token_version FROM users WHERE username = ?",
                       (form.username,)).fetchone()
    if row is None or not verify_password(row["password_hash"], form.password):
        limiter.hit(key)
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    limiter.reset(key)
    return _token_for(request, row["id"], row["token_version"])


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, request: Request, conn=Depends(get_conn)):
    s = request.app.state.settings
    if not s.allow_registration:
        raise HTTPException(status_code=403, detail="Máy chủ đang tắt đăng ký tài khoản mới")
    limiter = request.app.state.register_limiter
    key = _client_ip(request)
    if limiter.blocked(key):
        raise HTTPException(status_code=429, detail="Đăng ký quá nhiều lần, thử lại sau")
    _check_captcha(request, body.captcha_token)
    if s.invite_code and not hmac.compare_digest((body.invite_code or "").encode(), s.invite_code.encode()):
        limiter.hit(key)
        raise HTTPException(status_code=403, detail="Mã mời không đúng")
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=422, detail="Tên đăng nhập chỉ gồm chữ không dấu, số, _ . -")
    email = normalize_gmail(body.email)
    if email is None:
        raise HTTPException(status_code=422, detail="Email phải đúng định dạng Gmail (vd: ten@gmail.com)")
    if conn.execute("SELECT 1 FROM users WHERE lower(username) = lower(?)", (username,)).fetchone():
        raise HTTPException(status_code=409, detail="Tên đăng nhập đã tồn tại")
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(status_code=409, detail="Email đã được dùng cho tài khoản khác")
    user_id = conn.execute("INSERT INTO users(username, email, password_hash) VALUES (?, ?, ?) RETURNING id",
                           (username, email, hash_password(body.password))).fetchone()[0]
    conn.commit()
    limiter.hit(key)
    return _token_for(request, user_id)


FORGOT_MESSAGE = ("Nếu email này thuộc một tài khoản, mã xác nhận đã được gửi tới hộp thư. "
                  "Hãy kiểm tra cả thư mục Spam.")
RESET_FAILED = "Mã xác nhận không đúng hoặc đã hết hạn"


def _send_reset_mail(mailer, to: str, username: str, code: str, minutes: int) -> None:
    """Chay nen sau khi da tra loi request: thoi gian phan hoi khong de lo email co ton tai hay khong."""
    try:
        mailer.send(to, *reset_email(username, code, minutes))
    except Exception:  # noqa: BLE001
        log.exception("Khong gui duoc email dat lai mat khau")


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordRequest, request: Request, background: BackgroundTasks,
                    conn=Depends(get_conn)):
    """Buoc 1 quen mat khau: gui ma OTP toi email cua tai khoan.
    Luon tra CUNG MOT cau tra loi du email co ton tai hay khong (khong cho do tai khoan)."""
    st = request.app.state
    s = st.settings
    ip = _client_ip(request)
    if st.forgot_ip_limiter.blocked(ip):
        raise HTTPException(status_code=429, detail="Yêu cầu quá nhiều lần, thử lại sau ít phút")
    _check_captcha(request, body.captcha_token)
    email = normalize_gmail(body.email)
    if email is None:
        raise HTTPException(status_code=422, detail="Email phải đúng định dạng Gmail (vd: ten@gmail.com)")
    st.forgot_ip_limiter.hit(ip)
    # Gioi han theo email (ke ca email khong ton tai, de hanh vi giong nhau): chong spam hop thu nguoi khac.
    if st.forgot_email_limiter.blocked(email):
        return {"detail": FORGOT_MESSAGE}
    st.forgot_email_limiter.hit(email)
    row = conn.execute("SELECT id, username FROM users WHERE email = ?", (email,)).fetchone()
    if row is not None:
        code = reset_svc.issue_code(conn, row["id"], s.jwt_secret, ttl_seconds=s.reset_code_minutes * 60)
        background.add_task(_send_reset_mail, st.mailer, email, row["username"], code, s.reset_code_minutes)
    return {"detail": FORGOT_MESSAGE}


@router.post("/auth/reset-password")
def reset_password(body: ResetPasswordRequest, request: Request, conn=Depends(get_conn)):
    """Buoc 2: email + ma OTP + mat khau moi. Dung ma -> doi mat khau, tang token_version (dang xuat moi
    phien cu), xoa ma. Moi loi deu tra cung mot thong bao de khong lo tai khoan nao ton tai."""
    st = request.app.state
    s = st.settings
    ip = _client_ip(request)
    if st.reset_limiter.blocked(ip):
        raise HTTPException(status_code=429, detail="Nhập sai quá nhiều lần, thử lại sau ít phút")
    _check_captcha(request, body.captcha_token)
    email = normalize_gmail(body.email)
    row = conn.execute("SELECT id, username FROM users WHERE email = ?", (email,)).fetchone() if email else None
    if row is None or not reset_svc.verify_code(conn, row["id"], body.code, s.jwt_secret,
                                                max_attempts=s.reset_max_attempts):
        st.reset_limiter.hit(ip)
        raise HTTPException(status_code=400, detail=RESET_FAILED)
    conn.execute("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
                 (hash_password(body.new_password), row["id"]))
    conn.commit()
    st.reset_limiter.reset(ip)
    st.login_limiter.reset(f"{ip}|{row['username'].lower()}")  # mo khoa dang nhap neu truoc do bi chan
    return {"username": row["username"]}


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
                                 client_id=body.client_id, device_id=x_device_id, folder_id=body.folder_id)
    background.add_task(run_index, request.app, user["id"], note["id"])
    return note


@router.post("/notes/upload", status_code=201)
def upload_note(request: Request, background: BackgroundTasks, file: UploadFile = File(...),
                folder_id: int | None = Form(default=None),
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
                                     file_path=file_path, file_name=file_name, folder_id=folder_id)
    except Exception:
        if file_path:
            (s.upload_dir / file_path).unlink(missing_ok=True)
        raise
    background.add_task(run_index, request.app, user["id"], note["id"])
    return note


# ------------------------------------------------------------------ anh dinh kem (![[ten.png]])
@router.post("/attachments", status_code=201)
def upload_attachment(request: Request, file: UploadFile = File(...), name: str = Form(default=""),
                      user: dict = Depends(current_user), conn=Depends(get_conn)):
    s = request.app.state.settings
    limit = s.max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"Ảnh lớn hơn {s.max_upload_mb} MB")
    try:
        return att_svc.save(conn, user["id"], s.upload_dir, data, name or file.filename or "")
    except att_svc.BadImage:
        raise HTTPException(status_code=415, detail="Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP")


@router.get("/attachments/file")
def get_attachment(request: Request, name: str = Query(..., min_length=1, max_length=300),
                   user: dict = Depends(current_user), conn=Depends(get_conn)):
    try:
        path, mime = att_svc.get(conn, user["id"], request.app.state.settings.upload_dir, name)
    except att_svc.NotFound:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh")
    return FileResponse(path, media_type=mime, headers={
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400",
        "Content-Security-Policy": "default-src 'none'",
    })


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
    extra = {"folder_id": body.folder_id} if "folder_id" in body.model_fields_set else {}
    try:
        out = notes_svc.update_note(conn, user["id"], note_id, content=body.content,
                                    base_version=body.base_version, title=body.title, device_id=x_device_id,
                                    **extra)
    except notes_svc.NotFound:
        raise _not_found()
    except notes_svc.BadVersion:
        raise HTTPException(status_code=409, detail="base_version không hợp lệ (lớn hơn phiên bản hiện tại)")
    except notes_svc.TitleTaken:
        raise HTTPException(status_code=409, detail="Đã có ghi chú khác dùng tiêu đề này")
    if out["reindex"]:  # chi doi thu muc thi khong can embed lai
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
def related(note_id: int, limit: int = Query(10, ge=1, le=50), include_rejected: bool = Query(False),
            user: dict = Depends(current_user), conn=Depends(get_conn)):
    try:
        return notes_svc.related_notes(conn, user["id"], note_id, limit, include_rejected=include_rejected)
    except notes_svc.NotFound:
        raise _not_found()


@router.put("/notes/{note_id}/links/{other_id}")
def set_link_status(note_id: int, other_id: int, body: LinkStatusUpdate,
                    user: dict = Depends(current_user), conn=Depends(get_conn)):
    """Chap nhan (accepted), bo qua (rejected) hoac hoan tac (suggested) goi y lien ket giua hai ghi chu."""
    # Khong can user_lock: indexer doc link_decisions SAU khi da mo giao dich ghi (DELETE links),
    # nen SQLite tu tuan tu hoa hai ben; khoa nguoi dung se bat request cho ca buoc embedding.
    try:
        return notes_svc.set_link_status(conn, user["id"], note_id, other_id, body.status)
    except notes_svc.NotFound:
        raise _not_found()
    except notes_svc.NoLink:
        raise HTTPException(status_code=404, detail="Hai ghi chú này không có gợi ý liên kết")


@router.get("/notes/{note_id}/links/{other_id}/explain")
def explain_link(note_id: int, other_id: int, limit: int = Query(3, ge=1, le=10),
                 user: dict = Depends(current_user), conn=Depends(get_conn)):
    """Vi sao hai ghi chu duoc goi y: cac cap doan giong nhau nhat kem diem cosine."""
    try:
        return notes_svc.explain_link(conn, user["id"], note_id, other_id, limit)
    except notes_svc.NotFound:
        raise _not_found()
    except notes_svc.NoLink:
        raise HTTPException(status_code=404, detail="Hai ghi chú này không có gợi ý liên kết")


@router.get("/links/decisions")
def list_link_decisions(user: dict = Depends(current_user), conn=Depends(get_conn)):
    """Cac cap da duoc chap nhan/bo qua kem diem, va precision theo nguong tau."""
    decisions = notes_svc.link_decisions(conn, user["id"])
    taus = [round(0.5 + 0.05 * i, 2) for i in range(10)]
    return {"decisions": decisions, "precision": notes_svc.precision_by_threshold(decisions, taus)}


@router.get("/graph")
def graph(min_score: float = Query(0.0, ge=0.0, le=1.0), user: dict = Depends(current_user),
          conn=Depends(get_conn)):
    return notes_svc.graph(conn, user["id"], min_score)


# ------------------------------------------------------------------ thu muc
def _folder_errors(fn):
    try:
        return fn()
    except notes_svc.NotFound:
        raise HTTPException(status_code=404, detail="Không tìm thấy thư mục")
    except notes_svc.FolderTaken:
        raise HTTPException(status_code=409, detail="Đã có thư mục cùng tên")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/folders")
def list_folders(user: dict = Depends(current_user), conn=Depends(get_conn)):
    return notes_svc.list_folders(conn, user["id"])


@router.post("/folders", status_code=201)
def create_folder(body: FolderIn, user: dict = Depends(current_user), conn=Depends(get_conn),
                  x_device_id: str | None = Header(default=None)):
    return _folder_errors(lambda: notes_svc.create_folder(conn, user["id"], body.name, x_device_id))


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: int, body: FolderIn, user: dict = Depends(current_user), conn=Depends(get_conn),
                  x_device_id: str | None = Header(default=None)):
    return _folder_errors(lambda: notes_svc.rename_folder(conn, user["id"], folder_id, body.name, x_device_id))


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, user: dict = Depends(current_user), conn=Depends(get_conn),
                  x_device_id: str | None = Header(default=None)):
    """Xoa thu muc; ghi chu ben trong chuyen ra ngoai, khong bi xoa."""
    moved = _folder_errors(lambda: notes_svc.delete_folder(conn, user["id"], folder_id, x_device_id))
    return {"moved": moved}


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
    except LLMBusy:
        log.warning("Hoi dap: moi model deu dang qua tai")
        raise HTTPException(status_code=503, detail="Mô hình AI đang quá tải (phía Google). Bạn thử lại sau ít phút nhé.")
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


def _latest(db, user_id: int) -> int:
    with db.connection() as conn:
        return notes_svc.latest_event_id(conn, user_id)


def _poll(db, user_id: int, cursor: int) -> list[dict]:
    with db.connection() as conn:
        return notes_svc.changes_since(conn, user_id, cursor)


@router.get("/events")
async def events(request: Request, since: int | None = Query(default=None, ge=0),
                 max_seconds: int | None = Query(default=None, ge=1, le=3600),
                 user: dict = Depends(current_user_brief)):
    """Server-Sent Events: day su kien thay doi ghi chu. Client dung fetch co header Authorization
    (EventSource khong gui duoc header), tu noi lai kem `since` = id su kien cuoi da nhan.

    PostgreSQL: cho thong bao LISTEN/NOTIFY (EventHub), chi truy van khi co su kien cua nguoi dung nay
    (hoi lai moi 15 giay de an toan). SQLite: hoi CSDL moi giay nhu truoc. Luong SSE khong giu ket noi CSDL:
    moi lan truy van muon tu pool roi tra ngay."""
    st = request.app.state
    s, db, hub = st.settings, st.db, st.event_hub
    user_id = user["id"]

    async def stream():
        wake = hub.subscribe(user_id) if hub is not None else None
        try:
            cursor = since if since is not None else await run_in_threadpool(_latest, db, user_id)
            deadline = time.monotonic() + (max_seconds or s.sse_max_seconds)
            last_sent = time.monotonic()
            yield "retry: 3000\n\n"
            while time.monotonic() < deadline:
                if await request.is_disconnected():
                    break
                if wake is not None:
                    wake.clear()  # xoa truoc khi truy van: su kien den trong luc truy van se danh thuc lan sau
                batch = await run_in_threadpool(_poll, db, user_id, cursor)
                for e in batch:
                    cursor = e["id"]
                    last_sent = time.monotonic()
                    yield f"id: {e['id']}\nevent: note\ndata: {json.dumps(e)}\n\n"
                if time.monotonic() - last_sent >= 15:
                    last_sent = time.monotonic()
                    yield ": keepalive\n\n"
                if wake is None:
                    await asyncio.sleep(1.0)
                else:
                    try:
                        await asyncio.wait_for(wake.wait(), timeout=min(15.0, max(deadline - time.monotonic(), 0.1)))
                    except asyncio.TimeoutError:
                        pass
        finally:
            if wake is not None:
                hub.unsubscribe(user_id, wake)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
