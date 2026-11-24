import pytest

from app.core.db import connect, init_db
from app.services import attachments as att
from app.services.chunking import Chunk, extract_wikilinks
from tests.dbutil import fresh_conn, sqlite_only

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 16
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def _conn():
    conn = fresh_conn()
    conn.execute("INSERT INTO users(username, password_hash) VALUES ('a','x'), ('b','x')")
    conn.commit()
    return conn


def test_sniff_only_supported_images():
    assert [att.sniff(x) for x in (PNG, JPG, WEBP, b"GIF89a...", SVG, b"")] == ["png", "jpg", "webp", "gif", None, None]


def test_save_uses_real_type_unique_names_and_owner_only(tmp_path):
    conn = _conn()
    a = att.save(conn, 1, tmp_path, PNG, "Pasted image 20261120172700.png")
    assert a == {"name": "Pasted image 20261120172700.png", "mime": "image/png", "size": len(PNG)}
    b = att.save(conn, 1, tmp_path, PNG, "Pasted image 20261120172700.png")
    assert b["name"] == "Pasted image 20261120172700 1.png"  # trung ten -> them so
    # duoi file sai so voi noi dung that: sua theo noi dung
    assert att.save(conn, 1, tmp_path, JPG, "anh.png")["name"] == "anh.jpg"
    # ten co duong dan / ky tu dac biet bi lam sach (khong thoat ra ngoai thu muc)
    assert att.save(conn, 1, tmp_path, PNG, "../../etc/[x]|y.png")["name"] == "xy.png"
    path, mime = att.get(conn, 1, tmp_path, a["name"])
    assert path.read_bytes() == PNG and mime == "image/png" and path.is_relative_to(tmp_path)
    with pytest.raises(att.NotFound):
        att.get(conn, 2, tmp_path, a["name"])  # user khac khong doc duoc
    assert att.save(conn, 2, tmp_path, PNG, "Pasted image 20261120172700.png")["name"] == "Pasted image 20261120172700.png"


def test_rejects_non_images_and_svg(tmp_path):
    conn = _conn()
    for data in (SVG, b"hello", b"%PDF-1.7"):
        with pytest.raises(att.BadImage):
            att.save(conn, 1, tmp_path, data, "x.png")
    assert conn.execute("SELECT COUNT(*) FROM attachments").fetchone()[0] == 0
    assert not any(tmp_path.rglob("*.*"))


def test_image_embeds_are_not_wikilinks_and_not_embedded():
    text = "Xem ![[Pasted image 1.png]] va [[RAG]] va ![[Ghi chu nhung]] va ![[a.JPG|300]]"
    assert extract_wikilinks(text) == ["RAG", "Ghi chu nhung"]
    c = Chunk(0, "H", text)
    assert "Pasted image" not in c.embed_text() and "a.JPG" not in c.embed_text() and "[[RAG]]" in c.embed_text()


def test_orphan_images_found_and_deleted_only_when_unused(tmp_path):
    from app.services import notes

    conn = _conn()
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    used = att.save(conn, 1, tmp_path, png, "dung.png")["name"]
    sized = att.save(conn, 1, tmp_path, png, "co-do-rong.png")["name"]
    orphan = att.save(conn, 1, tmp_path, png, "bo-roi.png")["name"]
    other_user = att.save(conn, 2, tmp_path, png, "dung.png")["name"]  # ten trung nhung cua nguoi khac
    notes.create_note(conn, 1, "N", f"![[{used}]] va ![[{sized}|300]]")
    names = sorted(a["name"] for a in att.orphans(conn))
    assert names == sorted([orphan, other_user])  # anh cua user 2 khong duoc ghi chu cua user 1 "cuu"
    files_before = {p.name for p in tmp_path.rglob("*.png")}
    gone = att.delete_orphans(conn, tmp_path)
    assert {a["name"] for a in gone} == {orphan, other_user}
    assert len({p.name for p in tmp_path.rglob("*.png")}) == len(files_before) - 2
    assert att.orphans(conn) == []
    att.get(conn, 1, tmp_path, used)  # anh dang dung van con
