"""Truy hoi lai co do thi: vector + mo rong 1-hop qua links + RRF.

1. A = top_k chunk gan cau hoi nhat (vector).
2. B = ung vien mo rong 1-hop tu A qua bang links:
   - semantic: chunk o dau con lai cua canh, diem = diem chunk goc x diem canh;
   - wiki: voi ghi chu o dau con lai, lay wiki_per_note chunk giong cau hoi nhat,
     diem = diem chunk goc x 1.0.
   Mot chunk co the den tu nhieu hat giong; lay diem lon nhat.
3. Gop A va B, lay context_k chunk dau, theo graph_mode:
   - "rrf": RRF (B co trong so graph_weight). Luu y: RRF voi k=60 rat phang o dau danh sach, nen
     chi mot phan cong nho tu B cung du dao thu tu vector (da do duoc, xem SPEC.md muc 11).
   - "supplement": giu nguyen thu tu vector cho context_k - graph_slots vi tri dau, dung graph_slots
     vi tri cuoi (toi da context_k - 1) cho ung vien tot nhat tu do thi (thieu thi bu bang vector).
     Ket qua vector tot nhat luon giu hang 1.
use_graph=False cho baseline vector thuan. min_edge_score loc canh semantic yeu luc truy van.
"""
from collections import defaultdict
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    note_id: int
    title: str
    heading: str
    text: str
    score: float         # diem RRF
    vector_score: float  # cosine voi cau hoi
    via: str             # 'vector' | 'graph' | 'both'


def _marks(n: int) -> str:
    return ",".join("?" * n)


def _expand_graph(conn, store, user_id: int, q, seeds: dict[int, float], wiki_per_note: int,
                  min_edge_score: float = 0.0) -> dict[int, float]:
    cands: dict[int, float] = {}

    def bump(chunk_id: int, score: float) -> None:
        if score > cands.get(chunk_id, 0.0):
            cands[chunk_id] = score

    ids = list(seeds)
    m = _marks(len(ids))

    # semantic: doc canh theo ca hai chieu (src OR dst)
    rows = conn.execute(
        f"SELECT src_chunk, dst_chunk, score FROM links WHERE user_id = ? AND type = 'semantic' "
        f"AND (src_chunk IN ({m}) OR dst_chunk IN ({m}))",
        [user_id, *ids, *ids],
    ).fetchall()
    for r in rows:
        s, d, w = r["src_chunk"], r["dst_chunk"], r["score"]
        if s is None or d is None or s == d or w < min_edge_score:
            continue
        if s in seeds:
            bump(d, seeds[s] * w)
        if d in seeds:
            bump(s, seeds[d] * w)

    # wiki: tu ghi chu cua cac hat giong sang ghi chu duoc lien ket (hai chieu)
    note_score: dict[int, float] = {}
    for r in conn.execute(
        f"SELECT id, note_id FROM chunks WHERE user_id = ? AND id IN ({m})", [user_id, *ids]
    ):
        note_score[r["note_id"]] = max(note_score.get(r["note_id"], 0.0), seeds[r["id"]])
    if note_score:
        nids = list(note_score)
        nm = _marks(len(nids))
        other_score: dict[int, float] = {}
        for r in conn.execute(
            f"SELECT src_note, dst_note FROM links WHERE user_id = ? AND type = 'wiki' "
            f"AND dst_note IS NOT NULL AND (src_note IN ({nm}) OR dst_note IN ({nm}))",
            [user_id, *nids, *nids],
        ):
            for seed_note, other in ((r["src_note"], r["dst_note"]), (r["dst_note"], r["src_note"])):
                if seed_note in note_score and other != seed_note:
                    other_score[other] = max(other_score.get(other, 0.0), note_score[seed_note])
        for other, score in other_score.items():
            chunk_ids = [
                r[0] for r in conn.execute(
                    "SELECT id FROM chunks WHERE note_id = ? AND user_id = ?", (other, user_id))
            ]
            ranked = sorted(chunk_ids, key=lambda c: -float(np.dot(q, store.get_vector(c))))
            for cid in ranked[:wiki_per_note]:
                bump(cid, score)
    return cands


def _supplement_order(a: list[tuple[int, float]], b_scores: dict[int, float], context_k: int, slots: int) -> list[int]:
    vec = [cid for cid, _ in a]
    slots = min(max(slots, 0), max(context_k - 1, 0))  # luon giu it nhat 1 cho cho hat giong vector
    chosen = vec[: context_k - slots]
    extras = [c for c in sorted(b_scores, key=lambda c: -b_scores[c]) if c not in chosen][:slots]
    for c in vec:  # thieu ung vien do thi thi bu bang cac hat giong con lai
        if len(chosen) + len(extras) >= context_k:
            break
        if c not in chosen and c not in extras:
            extras.append(c)
    return chosen + extras


def retrieve(
    conn,
    store,
    embedder,
    user_id: int,
    question: str,
    *,
    top_k: int = 8,
    context_k: int = 5,
    rrf_k: int = 60,
    graph_weight: float = 1.0,
    use_graph: bool = True,
    wiki_per_note: int = 2,
    graph_mode: str = "rrf",
    graph_slots: int = 2,
    min_edge_score: float = 0.0,
) -> list[Hit]:
    q = np.asarray(embedder.encode([question])[0], dtype="float32")
    a = store.search(q, top_k)
    if not a:
        return []
    a_scores = dict(a)

    b_scores = (
        _expand_graph(conn, store, user_id, q, a_scores, wiki_per_note, min_edge_score) if use_graph else {}
    )
    b_order = sorted(b_scores, key=lambda c: -b_scores[c])

    if graph_mode == "supplement":
        ordered = _supplement_order(a, b_scores, context_k, graph_slots if use_graph else 0)
        fused = {cid: 1.0 / (rrf_k + pos) for pos, cid in enumerate(ordered, start=1)}
    elif graph_mode == "rrf":
        fused = defaultdict(float)
        for rank, (cid, _) in enumerate(a, start=1):
            fused[cid] += 1.0 / (rrf_k + rank)
        for rank, cid in enumerate(sorted(b_scores, key=lambda c: -b_scores[c]), start=1):
            fused[cid] += graph_weight / (rrf_k + rank)
        ordered = None
    else:
        raise ValueError(f"graph_mode khong hop le: {graph_mode!r}")

    vec_score = {
        cid: a_scores[cid] if cid in a_scores else float(np.dot(q, store.get_vector(cid)))
        for cid in fused
    }
    if ordered is None:
        ordered = sorted(fused, key=lambda c: (-fused[c], -vec_score[c]))[:context_k]

    info = {
        r["id"]: r
        for r in conn.execute(
            f"SELECT c.id, c.note_id, c.heading, c.text, n.title FROM chunks c "
            f"JOIN notes n ON n.id = c.note_id WHERE c.user_id = ? AND c.id IN ({_marks(len(ordered))})",
            [user_id, *ordered],
        )
    }
    hits: list[Hit] = []
    for cid in ordered:
        row = info.get(cid)
        if row is None:  # vector mo coi (SQLite va FAISS lech nhau)
            continue
        in_a, in_b = cid in a_scores, cid in b_scores
        hits.append(
            Hit(
                chunk_id=cid,
                note_id=row["note_id"],
                title=row["title"],
                heading=row["heading"],
                text=row["text"],
                score=fused[cid],
                vector_score=vec_score[cid],
                via="both" if in_a and in_b else ("vector" if in_a else "graph"),
            )
        )
    return hits
