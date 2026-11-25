"""Quan tri tai khoan (ban toi thieu): liet ke nguoi dung, khoa / mo khoa, xem ghi chu lap chi muc loi.

Nguyen tac rieng tu: admin chi thay SO LIEU va TIEU DE, khong bao gio doc duoc noi dung ghi chu cua nguoi khac.
SQL viet mot lan cho ca SQLite va PostgreSQL (dau ?), giong cac service khac.
"""


class AdminError(Exception):
    """Thao tac quan tri khong hop le (vd tu khoa chinh minh). Thong diep hien thang cho admin."""


def list_users(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at,
               (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id) AS note_count,
               (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.status = 'failed') AS failed_count
        FROM users u
        ORDER BY u.id
        """
    ).fetchall()
    return [
        {"id": r["id"], "username": r["username"], "email": r["email"], "role": r["role"],
         "is_active": bool(r["is_active"]), "created_at": str(r["created_at"]),
         "note_count": int(r["note_count"]), "failed_count": int(r["failed_count"])}
        for r in rows
    ]


def set_active(conn, admin_id: int, user_id: int, active: bool) -> dict:
    """Khoa / mo khoa. Khong cho admin tu khoa minh va khong khoa admin khac (tranh mat quyen quan tri)."""
    row = conn.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise LookupError(user_id)
    if not active:
        if user_id == admin_id:
            raise AdminError("Không thể tự khóa tài khoản của chính mình")
        if row["role"] == "admin":
            raise AdminError("Không thể khóa tài khoản quản trị viên khác")
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))
    conn.commit()
    return {"id": row["id"], "username": row["username"], "is_active": active}


def failed_notes(conn, limit: int = 200) -> list[dict]:
    """Ghi chu lap chi muc that bai cua moi nguoi dung: chi tieu de + thong bao loi, KHONG co noi dung."""
    rows = conn.execute(
        """
        SELECT n.id, n.title, n.error, n.source, n.updated_at, u.id AS user_id, u.username
        FROM notes n JOIN users u ON u.id = n.user_id
        WHERE n.status = 'failed'
        ORDER BY n.updated_at DESC, n.id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {"id": r["id"], "title": r["title"], "error": r["error"] or "", "source": r["source"],
         "updated_at": str(r["updated_at"]), "user_id": r["user_id"], "username": r["username"]}
        for r in rows
    ]
