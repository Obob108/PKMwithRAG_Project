"""Anh dinh kem trong ghi chu (dan Ctrl+V / keo tha), nhung bang ![[ten.png]] kieu Obsidian.

An toan: loai file xac dinh bang "magic bytes" (khong tin duoi file / Content-Type tu client), chi nhan
PNG / JPEG / GIF / WebP (khong nhan SVG vi co the chua script). Ten file tren dia do he thong dat.
"""
import re
import uuid
from pathlib import Path

from .notes import resolve_file

KINDS = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
_EXT_ALIASES = {"jpeg": "jpg"}


class NotFound(Exception):
    pass


class BadImage(Exception):
    pass


def sniff(data: bytes) -> str | None:
    """Duoi chuan ('png'|'jpg'|'gif'|'webp') theo noi dung file, None neu khong phai anh duoc ho tro."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def clean_name(name: str, ext: str) -> str:
    """Ten hien thi an toan: bo duong dan va ky tu la, giu tieng Viet, duoi khop voi noi dung that."""
    base = Path((name or "").replace("\\", "/")).name
    stem = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", base)
    stem = re.sub(r"[\[\]|#^:*?\"<>\x00-\x1f]", "", stem).strip(" .")[:100] or "Pasted image"
    return f"{stem}.{ext}"


def _unique(conn, user_id: int, name: str) -> str:
    stem, ext = name.rsplit(".", 1)
    candidate, n = name, 1
    while conn.execute("SELECT 1 FROM attachments WHERE user_id = ? AND name = ?", (user_id, candidate)).fetchone():
        candidate = f"{stem} {n}.{ext}"
        n += 1
    return candidate


def save(conn, user_id: int, upload_dir: Path, data: bytes, name: str) -> dict:
    ext = sniff(data)
    if ext is None:
        raise BadImage("Chi ho tro anh PNG, JPEG, GIF hoac WebP")
    final = _unique(conn, user_id, clean_name(name, ext))
    rel = f"{user_id}/att/{uuid.uuid4().hex}.{ext}"
    path = Path(upload_dir) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    try:
        conn.execute("INSERT INTO attachments(user_id, name, file_path, mime, size) VALUES (?, ?, ?, ?, ?)",
                     (user_id, final, rel, KINDS[ext], len(data)))
        conn.commit()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {"name": final, "mime": KINDS[ext], "size": len(data)}


def get(conn, user_id: int, upload_dir: Path, name: str) -> tuple[Path, str]:
    """(duong dan, mime) cua anh theo ten; chi chu so huu doc duoc."""
    row = conn.execute("SELECT file_path, mime FROM attachments WHERE user_id = ? AND name = ?",
                       (user_id, name)).fetchone()
    if row is None:
        raise NotFound(name)
    path = resolve_file(upload_dir, row["file_path"])
    if path is None or not path.is_file():
        raise NotFound(name)
    return path, row["mime"]


def orphans(conn) -> list[dict]:
    """Anh khong con ghi chu nao (cua chinh chu so huu) nhung bang ![[ten]] / ![[ten|rong]].
    Xoa ghi chu khong xoa anh vi mot anh co the dung o nhieu ghi chu; ham nay tim nhung anh da bi bo roi."""
    contents: dict[int, list[str]] = {}
    for r in conn.execute("SELECT user_id, content FROM notes"):
        contents.setdefault(r["user_id"], []).append(r["content"])
    out = []
    for r in conn.execute("SELECT id, user_id, name, file_path, size FROM attachments ORDER BY id"):
        refs = (f"![[{r['name']}]]", f"![[{r['name']}|")
        if not any(ref in c for c in contents.get(r["user_id"], []) for ref in refs):
            out.append({"id": r["id"], "user_id": r["user_id"], "name": r["name"], "file_path": r["file_path"],
                        "size": r["size"]})
    return out


def delete_orphans(conn, upload_dir: Path) -> list[dict]:
    """Xoa anh mo coi (dong trong CSDL + file). Tra ve danh sach da xoa."""
    gone = orphans(conn)
    for a in gone:
        conn.execute("DELETE FROM attachments WHERE id = ?", (a["id"],))
    conn.commit()
    for a in gone:  # xoa file SAU khi CSDL da commit: loi giua chung chi de lai file thua, khong mat anh dang dung
        path = resolve_file(Path(upload_dir), a["file_path"])
        if path is not None:
            path.unlink(missing_ok=True)
    return gone
