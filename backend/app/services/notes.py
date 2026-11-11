"""Dich vu ghi chu: phien ban, gop ba chieu, nhat ky su kien, ghi chu lien quan va do thi.

Mo hinh dong bo: may chu la nguon su that. Moi ghi chu co `version` tang dan; moi phien ban duoc luu
trong note_versions. Thiet bi gui ban sua kem `base_version` (phien ban no dong bo lan cuoi):
  - base_version == hien tai -> ap dung ("ok").
  - base_version <  hien tai -> gop ba chieu (base, may chu, thiet bi): "merged" neu khong xung dot,
    "conflict" neu co (giu ca hai ban trong khoi danh dau, khong mat du lieu).
Moi thay doi ghi mot dong vao `events` de cac thiet bi khac cap nhat truc tiep / keo ve sau khi online.
"""
from pathlib import Path

from . import merge


class NotFound(Exception):
    pass


class TitleTaken(Exception):
    pass


class BadVersion(Exception):
    pass


def _public(row, with_content: bool = True) -> dict:
    d = {
        "id": row["id"], "title": row["title"], "source": row["source"], "status": row["status"],
        "version": row["version"], "has_conflict": bool(row["has_conflict"]), "error": row["error"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
        "has_file": bool(row["file_path"]), "file_name": row["file_name"],
    }
    if with_content:
        d["content"] = row["content"]
    return d


def _get_row(conn, user_id: int, note_id: int):
    row = conn.execute("SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)).fetchone()
    if row is None:
        raise NotFound(note_id)
    return row


def _record(conn, user_id, note_id, version, title, content, type_, device_id) -> None:
    if type_ != "deleted":
        conn.execute(
            "INSERT INTO note_versions(note_id, version, title, content, device_id) VALUES (?, ?, ?, ?, ?)",
            (note_id, version, title, content, device_id),
        )
    conn.execute(
        "INSERT INTO events(user_id, type, note_id, version, device_id) VALUES (?, ?, ?, ?, ?)",
        (user_id, type_, note_id, version, device_id),
    )


def unique_title(conn, user_id: int, title: str) -> str:
    base = (title or "").strip()[:200] or "Không có tiêu đề"
    candidate, n = base, 2
    while conn.execute("SELECT 1 FROM notes WHERE user_id = ? AND title = ?", (user_id, candidate)).fetchone():
        candidate = f"{base} ({n})"
        n += 1
    return candidate


def create_note(conn, user_id: int, title: str, content: str = "", *, source: str = "md",
                client_id: str | None = None, device_id: str | None = None,
                file_path: str | None = None, file_name: str | None = None) -> dict:
    """Tao ghi chu. client_id (uuid do thiet bi sinh) giup gui lai khi mat mang khong tao trung."""
    if client_id:
        row = conn.execute(
            "SELECT * FROM notes WHERE user_id = ? AND client_id = ?", (user_id, client_id)).fetchone()
        if row:
            return _public(row)
    title = unique_title(conn, user_id, title)
    cur = conn.execute(
        "INSERT INTO notes(user_id, title, content, source, client_id, has_conflict, file_path, file_name) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, title, content, source, client_id, int(merge.has_conflict_markers(content)),
         file_path, file_name),
    )
    _record(conn, user_id, cur.lastrowid, 1, title, content, "created", device_id)
    conn.commit()
    return _public(_get_row(conn, user_id, cur.lastrowid))


def get_note(conn, user_id: int, note_id: int) -> dict:
    return _public(_get_row(conn, user_id, note_id))


def list_notes(conn, user_id: int, with_content: bool = False) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (user_id,)).fetchall()
    return [_public(r, with_content=with_content) for r in rows]


def update_note(conn, user_id: int, note_id: int, *, content: str, base_version: int,
                title: str | None = None, device_id: str | None = None) -> dict:
    """Tra ve {"result": "ok"|"merged"|"conflict", "changed": bool, "note": {...}}."""
    row = _get_row(conn, user_id, note_id)
    current = row["version"]
    if base_version < 1 or base_version > current:
        raise BadVersion(f"base_version={base_version}, hien tai={current}")

    new_title = row["title"]
    if base_version == current:
        new_content, result = content, "ok"
        if title is not None and title.strip():
            new_title = title.strip()
    else:
        base = conn.execute(
            "SELECT title, content FROM note_versions WHERE note_id = ? AND version = ?",
            (note_id, base_version)).fetchone()
        if base is None:  # khong con ban goc de gop: giu ca hai, de nguoi dung quyet
            if content == row["content"]:
                new_content, conflict = content, False
            else:
                new_content, conflict = merge.conflict_block(row["content"], content), True
            base_title = row["title"]
        else:
            new_content, conflict = merge.merge3(base["content"], row["content"], content)
            base_title = base["title"]
        result = "conflict" if conflict else "merged"
        # Tieu de: chi thiet bi doi thi nhan; ca hai cung doi khac nhau thi giu cua may chu.
        if title is not None and title.strip() and title != base_title and row["title"] == base_title:
            new_title = title.strip()

    if new_title != row["title"] and conn.execute(
        "SELECT 1 FROM notes WHERE user_id = ? AND title = ? AND id != ?", (user_id, new_title, note_id)
    ).fetchone():
        raise TitleTaken(new_title)

    if new_content == row["content"] and new_title == row["title"]:
        return {"result": result, "changed": False, "note": _public(row)}

    version = current + 1
    conn.execute(
        "UPDATE notes SET title = ?, content = ?, version = ?, status = 'pending', has_conflict = ?, "
        "error = NULL, updated_at = datetime('now') WHERE id = ?",
        (new_title, new_content, version, int(merge.has_conflict_markers(new_content)), note_id),
    )
    _record(conn, user_id, note_id, version, new_title, new_content, "updated", device_id)
    conn.commit()
    return {"result": result, "changed": True, "note": _public(_get_row(conn, user_id, note_id))}


def delete_note(conn, user_id: int, note_id: int, device_id: str | None = None,
                upload_dir: Path | None = None) -> None:
    row = _get_row(conn, user_id, note_id)
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    _record(conn, user_id, note_id, row["version"], row["title"], "", "deleted", device_id)
    conn.commit()
    if row["file_path"] and upload_dir is not None:  # xoa file goc sau khi DB da commit
        path = resolve_file(upload_dir, row["file_path"])
        if path is not None:
            path.unlink(missing_ok=True)


def resolve_file(upload_dir: Path, rel: str) -> Path | None:
    """Duong dan tuyet doi cua file goc, hoac None neu thoat ra ngoai thu muc uploads (chong path traversal)."""
    base = Path(upload_dir).resolve()
    path = (base / rel).resolve()
    return path if path.is_relative_to(base) else None


def get_file(conn, user_id: int, note_id: int, upload_dir: Path) -> tuple[Path, str] | None:
    """(duong dan, ten file) cua PDF goc; None neu ghi chu khong co file hoac file bi mat."""
    row = _get_row(conn, user_id, note_id)
    if not row["file_path"]:
        return None
    path = resolve_file(upload_dir, row["file_path"])
    if path is None or not path.is_file():
        return None
    return path, row["file_name"] or f"{row['title']}.pdf"


# ---------------------------------------------------------------- su kien / dong bo
def _event(r) -> dict:
    return {"id": r["id"], "type": r["type"], "note_id": r["note_id"], "version": r["version"],
            "device_id": r["device_id"], "created_at": r["created_at"]}


def latest_event_id(conn, user_id: int) -> int:
    return conn.execute("SELECT COALESCE(MAX(id), 0) FROM events WHERE user_id = ?", (user_id,)).fetchone()[0]


def changes_since(conn, user_id: int, since: int, limit: int = 500) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM events WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?", (user_id, since, limit)
    ).fetchall()
    return [_event(r) for r in rows]


# ---------------------------------------------------------------- lien ket
def related_notes(conn, user_id: int, note_id: int, limit: int = 10) -> list[dict]:
    _get_row(conn, user_id, note_id)
    rows = conn.execute(
        """
        SELECT other, type, MAX(score) AS score FROM (
            SELECT CASE WHEN src_note = :n THEN dst_note ELSE src_note END AS other, type, score
            FROM links WHERE user_id = :u AND (src_note = :n OR dst_note = :n)
        ) WHERE other IS NOT NULL AND other != :n GROUP BY other, type
        """,
        {"n": note_id, "u": user_id},
    ).fetchall()
    agg: dict[int, dict] = {}
    for r in rows:
        e = agg.setdefault(r["other"], {"note_id": r["other"], "semantic_score": None, "wiki": False})
        if r["type"] == "wiki":
            e["wiki"] = True
        else:
            e["semantic_score"] = r["score"]
    if not agg:
        return []
    marks = ",".join("?" * len(agg))
    titles = {r["id"]: r["title"] for r in conn.execute(
        f"SELECT id, title FROM notes WHERE user_id = ? AND id IN ({marks})", [user_id, *agg])}
    out = [dict(e, title=titles[e["note_id"]]) for e in agg.values() if e["note_id"] in titles]
    out.sort(key=lambda e: (not e["wiki"], -(e["semantic_score"] or 0.0), e["title"]))
    return out[:limit]


def graph(conn, user_id: int, min_score: float = 0.0) -> dict:
    """Nut = ghi chu; canh = cap ghi chu co lien ket (gop hai chieu va cac chunk)."""
    rows = conn.execute(
        "SELECT src_note, dst_note, type, MAX(score) AS score FROM links "
        "WHERE user_id = ? AND dst_note IS NOT NULL AND src_note != dst_note "
        "AND (type = 'wiki' OR score >= ?) GROUP BY src_note, dst_note, type",
        (user_id, min_score),
    ).fetchall()
    pairs: dict[tuple[int, int], dict] = {}
    for r in rows:
        key = (min(r["src_note"], r["dst_note"]), max(r["src_note"], r["dst_note"]))
        e = pairs.setdefault(key, {"source": key[0], "target": key[1], "semantic_score": None, "wiki": False})
        if r["type"] == "wiki":
            e["wiki"] = True
        else:
            e["semantic_score"] = max(e["semantic_score"] or 0.0, r["score"])
    degree: dict[int, int] = {}
    for a, b in pairs:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
    nodes = [{"id": r["id"], "title": r["title"], "source": r["source"], "has_file": bool(r["file_path"]),
              "degree": degree.get(r["id"], 0)}
             for r in conn.execute(
                 "SELECT id, title, source, file_path FROM notes WHERE user_id = ? ORDER BY id", (user_id,))]
    return {"nodes": nodes, "edges": list(pairs.values())}
