"""Nhap ca thu muc .md/.pdf cho mot user va lap chi muc.

Chay tu thu muc backend:
    python scripts/import_folder.py --user alice --dir "C:\\duong\\dan\\notes"
Tieu de ghi chu = ten file (khong co duoi), khop voi [[wiki-link]] kieu Obsidian.
"""
import argparse
import shutil
import sys
import uuid
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.db import connect, init_db  # noqa: E402
from app.services.embedding import Embedder  # noqa: E402
from app.services.indexer import index_note, upsert_note  # noqa: E402
from app.services.pdf import extract_pdf_markdown  # noqa: E402
from app.services.vector_store import VectorStores  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()

    settings = get_settings()
    conn = connect(settings.db_path)
    init_db(conn)
    user = conn.execute("SELECT id FROM users WHERE username = ?", (args.user,)).fetchone()
    if user is None:
        sys.exit(f"Chua co user '{args.user}'. Chay scripts/create_user.py truoc.")

    files = sorted(p for p in Path(args.dir).rglob("*") if p.suffix.lower() in (".md", ".pdf"))
    if not files:
        sys.exit("Khong tim thay file .md hoac .pdf nao.")

    embedder = Embedder(settings.embedding_model)
    stores = VectorStores(settings.faiss_dir)

    for path in files:
        start = time.time()
        if path.suffix.lower() == ".pdf":
            content, source = extract_pdf_markdown(path), "pdf"
        else:
            content, source = path.read_text(encoding="utf-8", errors="replace"), "md"
        note_id = upsert_note(conn, user["id"], path.stem, content, source)
        if source == "pdf":  # giu PDF goc de mo lai trong ung dung
            rel = f"{user['id']}/{uuid.uuid4().hex}.pdf"
            dest = settings.upload_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
            old = conn.execute("SELECT file_path FROM notes WHERE id = ?", (note_id,)).fetchone()["file_path"]
            conn.execute("UPDATE notes SET file_path = ?, file_name = ? WHERE id = ?", (rel, path.name, note_id))
            conn.commit()
            if old:
                (settings.upload_dir / old).unlink(missing_ok=True)
        status = index_note(
            conn, stores, embedder, note_id,
            link_top_k=settings.link_top_k, link_threshold=settings.link_threshold,
        )
        n_chunks = conn.execute("SELECT COUNT(*) FROM chunks WHERE note_id = ?", (note_id,)).fetchone()[0]
        n_links = conn.execute("SELECT COUNT(*) FROM links WHERE src_note = ?", (note_id,)).fetchone()[0]
        print(f"[{status}] {path.name}: {n_chunks} chunk, {n_links} canh, {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
