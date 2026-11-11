"""Kiem thu API bang TestClient (can fastapi, httpx, argon2: da co trong requirements.txt)."""
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import connect
from app.core.security import hash_password
from app.main import create_app
from tests.fakes import FakeEmbedder, FakeLLM, FakeStores

A = "retrieval augmented generation vector search embeddings"
B = "vector search embeddings faiss index"


@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path, jwt_secret="test-secret", link_threshold=0.3)
    app = create_app(settings, embedder=FakeEmbedder(dim=1024), llm=FakeLLM("Trả lời thử [1]."),
                     stores=FakeStores())
    with TestClient(app) as c:
        conn = connect(settings.db_path)
        for name in ("alice", "bob"):
            conn.execute("INSERT INTO users(username, password_hash) VALUES (?, ?)",
                         (name, hash_password("pw-" + name)))
        conn.commit()
        conn.close()
        yield c


def login(client, name="alice"):
    r = client.post("/api/auth/login", data={"username": name, "password": "pw-" + name})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_note(client, h, title, content, **extra):
    r = client.post("/api/notes", json={"title": title, "content": content, **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_health_and_auth(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.post("/api/auth/login", data={"username": "alice", "password": "sai"}).status_code == 401
    assert client.post("/api/auth/login", data={"username": "khong-co", "password": "x"}).status_code == 401
    assert client.get("/api/notes").status_code == 401
    assert client.get("/api/notes", headers={"Authorization": "Bearer rac"}).status_code == 401
    assert client.get("/api/me", headers=login(client)).json()["username"] == "alice"


def test_create_indexes_in_background_and_lists(client):
    h = login(client)
    note = make_note(client, h, "KH", A)
    assert note["version"] == 1
    got = client.get(f"/api/notes/{note['id']}", headers=h).json()
    assert got["status"] == "ready"  # tac vu nen da chay xong
    assert [n["title"] for n in client.get("/api/notes", headers=h).json()] == ["KH"]
    assert "content" not in client.get("/api/notes", headers=h).json()[0]


def test_offline_merge_over_http(client):
    h = login(client)
    n = make_note(client, h, "KH", "a\nb\nc\nd\n")
    r1 = client.put(f"/api/notes/{n['id']}", headers={**h, "X-Device-Id": "desktop"},
                    json={"content": "a\nB\nc\nd\n", "base_version": 1})
    assert r1.json()["result"] == "ok"
    r2 = client.put(f"/api/notes/{n['id']}", headers={**h, "X-Device-Id": "phone"},
                    json={"content": "a\nb\nc\nD\n", "base_version": 1})
    body = r2.json()
    assert r2.status_code == 200 and body["result"] == "merged"
    assert body["note"]["content"] == "a\nB\nc\nD\n" and body["note"]["version"] == 3


def test_conflict_over_http(client):
    h = login(client)
    n = make_note(client, h, "KH", "a\nb\nc\n")
    client.put(f"/api/notes/{n['id']}", headers=h, json={"content": "a\nB1\nc\n", "base_version": 1})
    r = client.put(f"/api/notes/{n['id']}", headers=h, json={"content": "a\nB2\nc\n", "base_version": 1})
    assert r.json()["result"] == "conflict" and r.json()["note"]["has_conflict"] is True


def test_validation_and_error_codes(client):
    h = login(client)
    n = make_note(client, h, "KH", "x")
    assert client.put(f"/api/notes/{n['id']}", headers=h, json={"content": "y", "base_version": 9}).status_code == 409
    assert client.put(f"/api/notes/{n['id']}", headers=h, json={"content": "y", "base_version": 0}).status_code == 422
    assert client.put("/api/notes/9999", headers=h, json={"content": "y", "base_version": 1}).status_code == 404
    assert client.post("/api/notes", headers=h, json={"title": "", "content": "x"}).status_code == 422
    other = make_note(client, h, "Khac", "z")
    r = client.put(f"/api/notes/{n['id']}", headers=h,
                   json={"content": "x", "base_version": 1, "title": other["title"]})
    assert r.status_code == 409


def test_users_cannot_touch_each_others_notes(client):
    ha, hb = login(client, "alice"), login(client, "bob")
    n = make_note(client, ha, "Rieng tu", A)
    assert client.get(f"/api/notes/{n['id']}", headers=hb).status_code == 404
    assert client.put(f"/api/notes/{n['id']}", headers=hb, json={"content": "hack", "base_version": 1}).status_code == 404
    assert client.delete(f"/api/notes/{n['id']}", headers=hb).status_code == 404
    assert client.get(f"/api/notes/{n['id']}/related", headers=hb).status_code == 404
    assert client.get("/api/notes", headers=hb).json() == []
    assert client.get(f"/api/notes/{n['id']}", headers=ha).json()["content"] == A


def test_delete_note(client):
    h = login(client)
    n = make_note(client, h, "KH", A)
    assert client.delete(f"/api/notes/{n['id']}", headers=h).status_code == 204
    assert client.get(f"/api/notes/{n['id']}", headers=h).status_code == 404


def test_create_with_client_id_is_idempotent(client):
    h = login(client)
    a = make_note(client, h, "KH", "x", client_id="uuid-1")
    b = make_note(client, h, "KH", "x", client_id="uuid-1")
    assert a["id"] == b["id"] and len(client.get("/api/notes", headers=h).json()) == 1


def test_related_graph_and_search(client):
    h = login(client)
    a = make_note(client, h, "A", A)
    b = make_note(client, h, "B", B)
    rel = client.get(f"/api/notes/{a['id']}/related", headers=h).json()
    assert [r["title"] for r in rel] == ["B"]
    g = client.get("/api/graph", headers=h).json()
    assert len(g["nodes"]) == 2 and len(g["edges"]) == 1
    assert client.get("/api/graph", params={"min_score": 0.99}, headers=h).json()["edges"] == []
    hits = client.get("/api/search", params={"q": "retrieval augmented generation"}, headers=h).json()
    assert hits and hits[0]["title"] == "A"


def test_chat_returns_answer_with_sources(client):
    h = login(client)
    make_note(client, h, "A", A)
    r = client.post("/api/chat", headers=h, json={"question": "retrieval augmented generation"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"] == "Trả lời thử [1]." and body["sources"][0]["title"] == "A"


def test_chat_with_no_notes_says_not_found(client):
    h = login(client)
    r = client.post("/api/chat", headers=h, json={"question": "gi do"})
    assert r.status_code == 200 and "Không tìm thấy" in r.json()["answer"] and r.json()["sources"] == []


def test_sync_changes_feed(client):
    h = login(client)
    cursor = client.get("/api/sync/changes", headers=h).json()
    assert cursor == {"cursor": 0, "events": []}
    n = make_note(client, h, "KH", "a")
    client.put(f"/api/notes/{n['id']}", headers={**h, "X-Device-Id": "phone"}, json={"content": "b", "base_version": 1})
    feed = client.get("/api/sync/changes", params={"since": 0}, headers=h).json()
    assert [e["type"] for e in feed["events"]] == ["created", "updated"]
    assert feed["events"][1]["device_id"] == "phone"
    after = client.get("/api/sync/changes", params={"since": feed["cursor"]}, headers=h).json()
    assert after == {"cursor": feed["cursor"], "events": []}
    assert client.get("/api/sync/changes", params={"since": 0}, headers=login(client, "bob")).json()["events"] == []


def test_sse_streams_events(client):
    h = login(client)
    make_note(client, h, "KH", "a")
    with client.stream("GET", "/api/events", params={"since": 0, "max_seconds": 2}, headers=h) as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())
    assert "event: note" in body and '"type": "created"' in body


def test_upload_markdown(client):
    h = login(client)
    r = client.post("/api/notes/upload", headers=h,
                    files={"file": ("Ghi_chu.md", "# Tieu de\nnoi dung".encode("utf-8"), "text/markdown")})
    assert r.status_code == 201 and r.json()["title"] == "Ghi_chu"
    assert client.post("/api/notes/upload", headers=h,
                       files={"file": ("virus.exe", b"x", "application/octet-stream")}).status_code == 415


# ---------------------------------------------------------------- dang ky, cau hinh, file goc
def test_config_and_register_flow(client):
    assert client.get("/api/config").json() == {"allow_registration": True, "invite_required": False}
    r = client.post("/api/auth/register", json={"username": "carol", "password": "matkhau-dai"})
    assert r.status_code == 201
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/me", headers=h).json()["username"] == "carol"
    assert client.post("/api/auth/login", data={"username": "carol", "password": "matkhau-dai"}).status_code == 200
    # trung ten (khong phan biet hoa thuong), mat khau ngan, ky tu la
    assert client.post("/api/auth/register", json={"username": "CAROL", "password": "matkhau-dai"}).status_code == 409
    assert client.post("/api/auth/register", json={"username": "dave", "password": "ngan"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "d a v e", "password": "matkhau-dai"}).status_code == 422


def test_register_disabled_and_invite_code(tmp_path):
    def make(**kw):
        s = Settings(data_dir=tmp_path / str(len(kw)), jwt_secret="t", **kw)
        return TestClient(create_app(s, embedder=FakeEmbedder(dim=1024), llm=FakeLLM("x"), stores=FakeStores()))

    with make(allow_registration=False) as c:
        assert c.post("/api/auth/register", json={"username": "eve", "password": "matkhau-dai"}).status_code == 403
    with make(invite_code="bi-mat") as c:
        assert c.get("/api/config").json()["invite_required"] is True
        assert c.post("/api/auth/register", json={"username": "eve", "password": "matkhau-dai"}).status_code == 403
        ok = c.post("/api/auth/register", json={"username": "eve", "password": "matkhau-dai", "invite_code": "bi-mat"})
        assert ok.status_code == 201


def test_login_is_rate_limited_after_failures(client):
    for _ in range(10):
        assert client.post("/api/auth/login", data={"username": "alice", "password": "sai"}).status_code == 401
    assert client.post("/api/auth/login", data={"username": "alice", "password": "sai"}).status_code == 429
    assert client.post("/api/auth/login", data={"username": "alice", "password": "pw-alice"}).status_code == 429


def test_list_full_and_pdf_original_is_stored_and_owner_only(client):
    pymupdf = pytest.importorskip("pymupdf")
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Retrieval augmented generation with vector search")
    pdf = doc.tobytes()
    ha, hb = login(client, "alice"), login(client, "bob")
    r = client.post("/api/notes/upload", headers=ha, files={"file": ("Bai bao.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    n = r.json()
    assert n["source"] == "pdf" and n["has_file"] is True and n["file_name"] == "Bai bao.pdf"
    f = client.get(f"/api/notes/{n['id']}/file", headers=ha)
    assert f.status_code == 200 and f.content.startswith(b"%PDF") and f.headers["content-type"] == "application/pdf"
    assert client.get(f"/api/notes/{n['id']}/file", headers=hb).status_code == 404
    assert client.get(f"/api/notes/{n['id']}/file").status_code == 401
    note_md = make_note(client, ha, "Thuong", "abc")
    assert client.get(f"/api/notes/{note_md['id']}/file", headers=ha).status_code == 404
    assert "content" not in client.get("/api/notes", headers=ha).json()[0]
    assert all("content" in x for x in client.get("/api/notes", params={"full": "true"}, headers=ha).json())
    nodes = {x["title"]: x for x in client.get("/api/graph", headers=ha).json()["nodes"]}
    assert nodes["Bai bao"]["has_file"] is True and nodes["Thuong"]["has_file"] is False
    assert client.delete(f"/api/notes/{n['id']}", headers=ha).status_code == 204
    assert client.get(f"/api/notes/{n['id']}/file", headers=ha).status_code == 404
