"""Tach ghi chu Markdown thanh chunk va trich wiki-link [[...]].

Chunk theo heading truoc, sau do gom cac doan van den ~max_chars ky tu
(xap xi 300-500 token cho tieng Viet/Anh), co chong lan nhe giua cac chunk.
Gioi han v1: khoi code co dong trong se bi cat o dong trong.
"""
import re
from dataclasses import dataclass

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
WIKILINK_RE = re.compile(r"\[\[([^\[\]|#]+?)(?:[#|][^\[\]]*)?\]\]")
SENTENCE_RE = re.compile(r"(?<=[.!?。])\s+")
PARAGRAPH_RE = re.compile(r"\n\s*\n")


@dataclass(frozen=True)
class Chunk:
    idx: int
    heading: str
    text: str

    def embed_text(self) -> str:
        """Van ban dua vao model embedding: them heading de co ngu canh."""
        return f"{self.heading}\n{self.text}" if self.heading else self.text


def extract_wikilinks(text: str) -> list[str]:
    """Tra ve danh sach tieu de trong [[...]], giu thu tu, khong trung lap."""
    titles: list[str] = []
    for m in WIKILINK_RE.finditer(text):
        title = m.group(1).strip()
        if title and title not in titles:
            titles.append(title)
    return titles


def _split_sections(text: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    stack: list[tuple[int, str]] = []
    buf: list[str] = []
    in_fence = False
    current = ""

    def flush() -> None:
        body = "\n".join(buf).strip()
        if body:
            sections.append((current, body))
        buf.clear()

    for line in text.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            buf.append(line)
            continue
        m = None if in_fence else HEADING_RE.match(line)
        if m:
            flush()
            level, title = len(m.group(1)), m.group(2)
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            current = " > ".join(t for _, t in stack)
        else:
            buf.append(line)
    flush()
    return sections


def _split_long(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]
    pieces: list[str] = []
    cur = ""
    for sentence in SENTENCE_RE.split(paragraph):
        while len(sentence) > max_chars:  # cau qua dai: cat cung
            if cur:
                pieces.append(cur)
                cur = ""
            pieces.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        if cur and len(cur) + 1 + len(sentence) > max_chars:
            pieces.append(cur)
            cur = sentence
        else:
            cur = f"{cur} {sentence}".strip() if cur else sentence
    if cur:
        pieces.append(cur)
    return pieces


def chunk_markdown(text: str, max_chars: int = 1500, overlap_chars: int = 200) -> list[Chunk]:
    chunks: list[Chunk] = []
    for heading, body in _split_sections(text):
        pieces: list[str] = []
        for para in PARAGRAPH_RE.split(body):
            para = para.strip()
            if para:
                pieces.extend(_split_long(para, max_chars))

        cur: list[str] = []
        size = 0
        for piece in pieces:
            add = len(piece) + (2 if cur else 0)
            if cur and size + add > max_chars:
                chunks.append(Chunk(len(chunks), heading, "\n\n".join(cur)))
                tail = cur[-1] if len(cur[-1]) <= overlap_chars else None
                cur = [tail] if tail else []
                size = len(tail) if tail else 0
                add = len(piece) + (2 if cur else 0)
            cur.append(piece)
            size += add
        if cur:
            chunks.append(Chunk(len(chunks), heading, "\n\n".join(cur)))
    return chunks
