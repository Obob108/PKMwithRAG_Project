"""Pipeline lap chi muc: ghi chu -> chunk -> embed -> SQLite + FAISS -> canh lien ket.

Thu tu trong index_note (de han che trang thai nua chung khi loi):
  1. Chunk + embed (cham, chua dong vao DB hay FAISS).
  2. Tim lang gieng cho chunk moi TRUOC khi dong vao chi muc, bo qua vector cu cua chinh ghi chu.
  3. Xoa chunk/canh cu, ghi chunk/canh moi, cap nhat FAISS, roi moi commit.
Neu FAISS va SQLite lech nhau (hiem), chay lai reindex toan bo.

Gioi han v1: moi canh semantic chi luu mot chieu (chunk moi -> lang gieng); truy van doc
canh hai chieu bang src OR dst. Chua tinh lai canh cua ghi chu cu khi ghi chu moi xuat hien
(chi canh xuat phat tu chunk moi).
"""
import hashlib
import logging

import numpy as np

from . import notes as notes_svc
from .chunking import chunk_markdown, extract_wikilinks

log = logging.getLogger(__name__)


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def upsert_note(conn, user_id: int, title: str, content: str, source: str = "md") -> int:
    """Tao hoac cap nhat ghi chu theo (user_id, title). Noi dung khong doi thi giu nguyen.

    Cap nhat di qua dich vu ghi chu (tang version, ghi su kien), nhu mot thiet bi dong bo day du.
    """
    row = conn.execute(
        "SELECT id, content, source, version FROM notes WHERE user_id = ? AND title = ?", (user_id, title)
    ).fetchone()
    if row is None:
        return notes_svc.create_note(conn, user_id, title, content, source=source)["id"]
    if row["content"] != content:
        notes_svc.update_note(conn, user_id, row["id"], content=content, base_version=row["version"])
    if row["source"] != source:
        conn.execute("UPDATE notes SET source = ?, status = 'pending' WHERE id = ?", (source, row["id"]))
        conn.commit()
    return row["id"]


def index_note(
    conn,
    stores,
    embedder,
    note_id: int,
    *,
    link_top_k: int = 5,
    link_threshold: float = 0.65,
    force: bool = False,
) -> str:
    """Lap chi muc mot ghi chu. Tra ve trang thai cuoi: 'ready' hoac 'failed'."""
    note = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if note is None:
        raise ValueError(f"Khong co ghi chu id={note_id}")

    content_hash = _hash(note["content"])
    if not force and note["status"] == "ready" and note["content_hash"] == content_hash:
        return "ready"

    conn.execute("UPDATE notes SET status = 'indexing', error = NULL WHERE id = ?", (note_id,))
    conn.commit()

    try:
        chunks = chunk_markdown(note["content"])
        vectors = (
            embedder.encode([c.embed_text() for c in chunks])
            if chunks
            else np.zeros((0, 0), dtype="float32")
        )
        store = stores.get(note["user_id"])
        _replace_index(conn, store, note, chunks, vectors, link_top_k, link_threshold)
        conn.execute(
            "UPDATE notes SET status = 'ready', content_hash = ?, error = NULL, "
            "updated_at = datetime('now') WHERE id = ?",
            (content_hash, note_id),
        )
        conn.commit()
        return "ready"
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        log.exception("Lap chi muc that bai cho ghi chu %s", note_id)
        conn.execute(
            "UPDATE notes SET status = 'failed', error = ? WHERE id = ?", (str(exc)[:500], note_id)
        )
        conn.commit()
        return "failed"


def _replace_index(conn, store, note, chunks, vectors, link_top_k, link_threshold) -> None:
    note_id, user_id = note["id"], note["user_id"]
    old_ids = [r[0] for r in conn.execute("SELECT id FROM chunks WHERE note_id = ?", (note_id,))]
    old_set = set(old_ids)

    # 1) Lang gieng cua chunk moi (vector cu cua chinh ghi chu nay bi bo qua).
    neighbors: list[list[tuple[int, float]]] = []
    for vec in vectors:
        hits = store.search(vec, link_top_k + len(old_ids))
        hits = [(cid, s) for cid, s in hits if cid not in old_set and s >= link_threshold]
        neighbors.append(hits[:link_top_k])

    # 2) Xoa chunk cu (cascade xoa canh tro toi chunk cu) va canh xuat phat tu ghi chu nay.
    conn.execute("DELETE FROM links WHERE src_note = ?", (note_id,))
    conn.execute("DELETE FROM chunks WHERE note_id = ?", (note_id,))

    # 3) Ghi chunk moi.
    new_ids: list[int] = []
    for chunk in chunks:
        cur = conn.execute(
            "INSERT INTO chunks(note_id, user_id, idx, heading, text) VALUES (?, ?, ?, ?, ?)",
            (note_id, user_id, chunk.idx, chunk.heading, chunk.text),
        )
        new_ids.append(cur.lastrowid)

    # 4) Canh semantic.
    dst_ids = {cid for hits in neighbors for cid, _ in hits}
    note_of: dict[int, int] = {}
    if dst_ids:
        marks = ",".join("?" * len(dst_ids))
        for r in conn.execute(f"SELECT id, note_id FROM chunks WHERE id IN ({marks})", list(dst_ids)):
            note_of[r["id"]] = r["note_id"]
    for src_chunk, hits in zip(new_ids, neighbors):
        for dst_chunk, score in hits:
            dst_note = note_of.get(dst_chunk)
            if dst_note is None or dst_note == note_id:
                continue
            conn.execute(
                "INSERT INTO links(user_id, src_note, dst_note, src_chunk, dst_chunk, type, score) "
                "VALUES (?, ?, ?, ?, ?, 'semantic', ?)",
                (user_id, note_id, dst_note, src_chunk, dst_chunk, score),
            )

    # 5) Canh wiki [[tieu de]] (dst_note NULL neu chua co ghi chu).
    for title in extract_wikilinks(note["content"]):
        target = conn.execute(
            "SELECT id FROM notes WHERE user_id = ? AND title = ? AND id != ?",
            (user_id, title, note_id),
        ).fetchone()
        conn.execute(
            "INSERT INTO links(user_id, src_note, dst_note, dst_title, type, score) "
            "VALUES (?, ?, ?, ?, 'wiki', 1.0)",
            (user_id, note_id, target["id"] if target else None, title),
        )

    # 6) Cac wiki-link tu ghi chu khac dang cho tieu de nay.
    conn.execute(
        "UPDATE links SET dst_note = ? WHERE user_id = ? AND type = 'wiki' "
        "AND dst_note IS NULL AND dst_title = ?",
        (note_id, user_id, note["title"]),
    )

    # 7) Cap nhat FAISS roi luu, sau do caller commit.
    store.remove(old_ids)
    store.add(new_ids, vectors)
    store.save()


def delete_note(conn, stores, note_id: int, *, device_id: str | None = None, upload_dir=None) -> None:
    """Xoa ghi chu cung vector, chunk, canh (cascade) va ghi su kien 'deleted'."""
    note = conn.execute("SELECT user_id FROM notes WHERE id = ?", (note_id,)).fetchone()
    if note is None:
        return
    ids = [r[0] for r in conn.execute("SELECT id FROM chunks WHERE note_id = ?", (note_id,))]
    store = stores.get(note["user_id"])
    store.remove(ids)
    store.save()
    notes_svc.delete_note(conn, note["user_id"], note_id, device_id=device_id, upload_dir=upload_dir)
