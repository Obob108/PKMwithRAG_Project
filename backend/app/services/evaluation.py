"""Do chat luong truy hoi: vector thuan vs truy hoi lai (quet graph_weight).

File cau hoi la JSONL, moi dong mot cau:
  {"id": "q01", "question": "...", "gold_notes": ["04_Semantic_Linking"], "type": "direct", "lang": "vi"}
- gold_notes: cac "y can co" de tra loi. Moi phan tu la mot tieu de (ten file khong duoi), hoac mot
  danh sach tieu de THAY THE NHAU (noi dung trung, vd ghi chu va PDF tom tat): chi can tim thay mot.
  Vi du: ["08_Chunking", ["12_Citations", "Tom_tat_RAG"]]  -> can ca 2 y; y thu 2 co 2 nguon chap nhan duoc.
- type: "direct" (cau tra loi nam o mot ghi chu) hoac "multi" (can ghep nhieu ghi chu).
Do o muc ghi chu: danh sach xep hang la cac ghi chu khac nhau theo thu tu chunk dau tien cua chung.
"""
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .retrieval import retrieve


def _normalize(gold) -> tuple[tuple[str, ...], ...]:
    groups = []
    for g in gold:
        alts = (g,) if isinstance(g, str) else tuple(g)
        if not alts or not all(isinstance(a, str) and a for a in alts):
            raise ValueError(f"gold_notes khong hop le: {g!r}")
        groups.append(alts)
    if not groups:
        raise ValueError("gold_notes khong duoc rong")
    return tuple(groups)


@dataclass(frozen=True)
class Question:
    id: str
    question: str
    gold_notes: tuple  # chuan hoa thanh tuple cac nhom thay the: (("A",), ("B", "B_pdf"))
    type: str = "direct"
    lang: str = ""

    def __post_init__(self):
        object.__setattr__(self, "gold_notes", _normalize(self.gold_notes))


@dataclass(frozen=True)
class Config:
    name: str
    use_graph: bool
    graph_weight: float = 1.0
    mode: str = "rrf"        # "rrf" | "supplement"
    slots: int = 2           # chi dung cho mode "supplement"
    min_edge: float = 0.0


def load_questions(path: str | Path) -> list[Question]:
    questions: list[Question] = []
    for lineno, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            d = json.loads(line)
            gold = d["gold_notes"]
            if not isinstance(gold, list):
                raise ValueError("gold_notes phai la danh sach")
            questions.append(
                Question(str(d["id"]), d["question"], tuple(gold), d.get("type", "direct"), d.get("lang", ""))
            )
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f"{path}, dong {lineno}: {exc!r}") from exc
    return questions


def missing_gold(conn, user_id: int, questions: list[Question]) -> dict[str, list[str]]:
    """Cau hoi nao tro toi tieu de ghi chu khong ton tai (thuong la go sai ten)."""
    titles = {r[0] for r in conn.execute("SELECT title FROM notes WHERE user_id = ?", (user_id,))}
    out = {}
    for q in questions:
        absent = [t for group in q.gold_notes for t in group if t not in titles]
        if absent:
            out[q.id] = absent
    return out


def ranked_notes(hits) -> list[str]:
    seen: list[str] = []
    for h in hits:
        if h.title not in seen:
            seen.append(h.title)
    return seen


def recall_at_k(ranked: list[str], gold, k: int) -> float:
    groups, top = _normalize(gold), set(ranked[:k])
    return sum(1 for g in groups if top & set(g)) / len(groups)


def reciprocal_rank(ranked: list[str], gold) -> float:
    relevant = {t for g in _normalize(gold) for t in g}
    for i, title in enumerate(ranked, 1):
        if title in relevant:
            return 1.0 / i
    return 0.0


def all_gold_at_k(ranked: list[str], gold, k: int) -> float:
    top = set(ranked[:k])
    return 1.0 if all(top & set(g) for g in _normalize(gold)) else 0.0


class _CachedEmbedder:
    """Moi cau hoi chi embed mot lan du chay nhieu cau hinh."""

    def __init__(self, inner):
        self.inner, self.cache = inner, {}

    def encode(self, texts, batch_size: int = 16):
        out = []
        for t in texts:
            if t not in self.cache:
                self.cache[t] = self.inner.encode([t])[0]
            out.append(self.cache[t])
        return np.stack(out)


def default_configs(weights=(0.25, 0.5, 1.0), slots=(1, 2), min_edges=(0.0, 0.75)) -> list[Config]:
    cfgs = [Config("vector", False)]
    cfgs += [Config(f"rrf w={w:g}", True, w) for w in weights]
    for sl in slots:
        for e in min_edges:
            name = f"supp s={sl}" + (f" e>={e:g}" if e > 0 else "")
            cfgs.append(Config(name, True, mode="supplement", slots=sl, min_edge=e))
    return cfgs


def evaluate(conn, store, embedder, user_id, questions, configs, *, top_k=10, context_k=10, ks=(3, 5)) -> list[dict]:
    embedder = _CachedEmbedder(embedder)
    rows = []
    for cfg in configs:
        for q in questions:
            hits = retrieve(conn, store, embedder, user_id, q.question, top_k=top_k, context_k=context_k,
                            use_graph=cfg.use_graph, graph_weight=cfg.graph_weight, graph_mode=cfg.mode,
                            graph_slots=cfg.slots, min_edge_score=cfg.min_edge)
            ranked = ranked_notes(hits)
            row = {"config": cfg.name, "id": q.id, "type": q.type, "question": q.question,
                   "gold": "|".join("+".join(g) for g in q.gold_notes), "ranked": "|".join(ranked[:context_k]),
                   "rr": reciprocal_rank(ranked, q.gold_notes)}
            for k in ks:
                row[f"recall@{k}"] = recall_at_k(ranked, q.gold_notes, k)
                row[f"all@{k}"] = all_gold_at_k(ranked, q.gold_notes, k)
            rows.append(row)
    return rows


def summarize(rows: list[dict], ks=(3, 5)) -> list[dict]:
    """Trung binh theo (config, type) va (config, 'all'), giu thu tu cau hinh."""
    out, order = [], list(dict.fromkeys(r["config"] for r in rows))
    types = sorted({r["type"] for r in rows}) + ["all"]
    for cfg in order:
        for t in types:
            sel = [r for r in rows if r["config"] == cfg and (t == "all" or r["type"] == t)]
            if not sel:
                continue
            s = {"config": cfg, "type": t, "n": len(sel), "mrr": sum(r["rr"] for r in sel) / len(sel)}
            for k in ks:
                s[f"recall@{k}"] = sum(r[f"recall@{k}"] for r in sel) / len(sel)
                s[f"all@{k}"] = sum(r[f"all@{k}"] for r in sel) / len(sel)
            out.append(s)
    return out


def split_questions(questions: list[Question], part: str) -> list[Question]:
    """Chia dev/test theo vi tri (1-based): dev = vi tri chan, test = vi tri le. 'all' giu nguyen."""
    if part == "all":
        return list(questions)
    if part not in ("dev", "test"):
        raise ValueError("part phai la all, dev hoac test")
    want = 0 if part == "dev" else 1
    return [q for i, q in enumerate(questions, 1) if i % 2 == want]


def regressions(rows: list[dict], config: str, baseline: str = "vector") -> list[dict]:
    """Cac cau ma `config` xep tot nhat-lien-quan thap hon hoac recall@5 thap hon baseline."""
    base = {r["id"]: r for r in rows if r["config"] == baseline}
    out = []
    for r in rows:
        b = base.get(r["id"])
        if r["config"] == config and b and (r["rr"] < b["rr"] - 1e-9 or r["recall@5"] < b["recall@5"] - 1e-9):
            out.append({"id": r["id"], "question": r["question"], "gold": r["gold"],
                        "rr_base": b["rr"], "rr_cfg": r["rr"],
                        "base_top": b["ranked"].split("|")[:5], "cfg_top": r["ranked"].split("|")[:5]})
    return out


def paired_diff(rows: list[dict], config: str, baseline: str = "vector", metric: str = "all@5",
                qtype: str = "all", n_boot: int = 5000, seed: int = 0) -> dict | None:
    """Chenh lech trung binh (config - baseline) theo tung cau, khoang tin cay 95% bang bootstrap ghep cap.

    Voi so cau nho khoang tin cay se rong: day la y nghia cua no, khong phai loi.
    """
    import random

    def pick(name):
        return {r["id"]: r[metric] for r in rows
                if r["config"] == name and (qtype == "all" or r["type"] == qtype)}

    base, cfg = pick(baseline), pick(config)
    diffs = [cfg[i] - base[i] for i in cfg if i in base]
    n = len(diffs)
    if n == 0:
        return None
    rng = random.Random(seed)
    boots = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot))
    return {
        "n": n, "mean": sum(diffs) / n,
        "lo": boots[int(0.025 * n_boot)], "hi": boots[int(0.975 * n_boot) - 1],
        "better": sum(d > 1e-9 for d in diffs), "worse": sum(d < -1e-9 for d in diffs),
        "tie": sum(abs(d) <= 1e-9 for d in diffs),
    }
