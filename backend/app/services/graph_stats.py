"""Thong ke do thi lien ket: bac (so canh semantic) cua tung ghi chu, de phat hien 'hub'."""


def note_degrees(conn, user_id: int) -> list[dict]:
    """Moi ghi chu: so chunk, so canh semantic (hai chieu), diem canh trung binh, canh/chunk."""
    rows = conn.execute(
        """
        SELECT n.id, n.title,
               (SELECT COUNT(*) FROM chunks c WHERE c.note_id = n.id) AS chunks,
               (SELECT COUNT(*) FROM links l WHERE l.user_id = n.user_id AND l.type = 'semantic'
                  AND (l.src_note = n.id OR l.dst_note = n.id)) AS edges,
               (SELECT AVG(l.score) FROM links l WHERE l.user_id = n.user_id AND l.type = 'semantic'
                  AND (l.src_note = n.id OR l.dst_note = n.id)) AS avg_score
        FROM notes n WHERE n.user_id = ?
        """,
        (user_id,),
    ).fetchall()
    out = [
        {"title": r["title"], "chunks": r["chunks"], "edges": r["edges"],
         "avg_score": r["avg_score"] or 0.0,
         "edges_per_chunk": (r["edges"] / r["chunks"]) if r["chunks"] else 0.0}
        for r in rows
    ]
    return sorted(out, key=lambda d: (-d["edges"], d["title"]))
