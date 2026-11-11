"""Gop ba chieu (diff3) theo dong cho ghi chu Markdown.

merge3(base, ours, theirs):
  base   = phien ban chung ma ca hai ben cung xuat phat,
  ours   = ban tren may chu (hien tai), theirs = ban thiet bi gui len.
Quy tac:
  - Hai ben sua o cac cho khac nhau  -> gop tu dong.
  - Hai ben cung CHEN them dong o cung vi tri -> giu ca hai (ours truoc), bo phan trung o dau/cuoi.
  - Hai ben sua/xoa cung cac dong theo cach khac nhau -> xung dot: giu CA HAI trong khoi danh dau
    (kieu git), khong bao gio mat du lieu.
Gioi han: theo dong; hai ben sua hai cau khac nhau trong CUNG mot dong dai se bi coi la xung dot.
"""
import re
from difflib import SequenceMatcher

START = "<<<<<<< MÁY CHỦ (bản hiện tại)\n"
MID = "=======\n"
END = ">>>>>>> THIẾT BỊ CỦA BẠN\n"


def has_conflict_markers(text: str) -> bool:
    return bool(
        re.search(r"^<<<<<<< ", text, re.M)
        and re.search(r"^=======\s*$", text, re.M)
        and re.search(r"^>>>>>>> ", text, re.M)
    )


def conflict_block(ours: str, theirs: str) -> str:
    nl = lambda t: t if not t or t.endswith("\n") else t + "\n"  # noqa: E731
    return START + nl(ours) + MID + nl(theirs) + END


def _match_map(o: list[str], x: list[str]) -> list[int | None]:
    m: list[int | None] = [None] * len(o)
    for blk in SequenceMatcher(None, o, x, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            m[blk.a + k] = blk.b + k
    return m


def _merge_insertions(seg_a: list[str], seg_b: list[str]) -> list[str]:
    n = min(len(seg_a), len(seg_b))
    p = 0
    while p < n and seg_a[p] == seg_b[p]:
        p += 1
    s = 0
    while s < n - p and seg_a[-1 - s] == seg_b[-1 - s]:
        s += 1
    suffix = seg_a[len(seg_a) - s:] if s else []
    return seg_a[:p] + seg_a[p:len(seg_a) - s] + seg_b[p:len(seg_b) - s] + suffix


def merge3(base: str, ours: str, theirs: str) -> tuple[str, bool]:
    """Tra ve (van_ban_gop, co_xung_dot)."""
    if ours == theirs:
        return ours, False
    if base == ours:
        return theirs, False
    if base == theirs:
        return ours, False

    nl = lambda t: t if not t or t.endswith("\n") else t + "\n"  # noqa: E731
    o, a, b = (nl(t).splitlines(keepends=True) for t in (base, ours, theirs))
    ma, mb = _match_map(o, a), _match_map(o, b)
    sync = [(i, ma[i], mb[i]) for i in range(len(o)) if ma[i] is not None and mb[i] is not None]
    sync.append((len(o), len(a), len(b)))

    out: list[str] = []
    conflict = False
    pi = pa = pb = 0
    for i, ja, jb in sync:
        seg_o, seg_a, seg_b = o[pi:i], a[pa:ja], b[pb:jb]
        if seg_a == seg_o:
            out += seg_b
        elif seg_b == seg_o:
            out += seg_a
        elif seg_a == seg_b:
            out += seg_a
        elif not seg_o:
            out += _merge_insertions(seg_a, seg_b)
        else:
            conflict = True
            out += [START, *seg_a, MID, *seg_b, END]
        if i < len(o):
            out.append(o[i])
        pi, pa, pb = i + 1, ja + 1, jb + 1

    result = "".join(out)
    if not (ours.endswith("\n") or theirs.endswith("\n")) and result.endswith("\n"):
        result = result[:-1]
    return result, conflict
