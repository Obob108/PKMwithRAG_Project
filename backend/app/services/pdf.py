"""Trich text tu PDF (khong OCR) thanh Markdown tho, moi trang la mot heading."""
import re
from pathlib import Path


def _clean_block(text: str) -> str:
    text = re.sub(r"-\n(?=\w)", "", text)  # noi tu bi ngat dong bang gach noi
    text = re.sub(r"\s*\n\s*", " ", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def pages_to_markdown(pages: list[list[str]]) -> str:
    """pages: moi phan tu la danh sach block text cua mot trang."""
    parts: list[str] = []
    for number, blocks in enumerate(pages, start=1):
        paragraphs = [b for b in (_clean_block(b) for b in blocks) if b]
        if paragraphs:
            parts.append(f"# Trang {number}\n\n" + "\n\n".join(paragraphs))
    return "\n\n".join(parts)


def extract_pdf_markdown(path: str | Path) -> str:
    try:
        import pymupdf
    except ImportError:  # ban PyMuPDF cu
        import fitz as pymupdf

    pages: list[list[str]] = []
    with pymupdf.open(str(path)) as doc:
        for page in doc:
            blocks = page.get_text("blocks", sort=True)
            pages.append([b[4] for b in blocks if b[6] == 0])  # b[6] == 0: block text
    return pages_to_markdown(pages)
