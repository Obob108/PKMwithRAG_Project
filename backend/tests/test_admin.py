"""Kiem thu quan tri: phan quyen (403/401), khoa / mo khoa, ghi chu loi chi lo tieu de + loi."""
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import connect
from app.core.security import hash_password
from app.main import create_app
from tests.dbutil import database_url_for
from tests.fakes import FakeEmbedder, FakeLLM, FakeMailer, FakeStores

ADMIN_ENDPOINTS = [
    ("get", "/api/admin/users"),
    ("get", "/api/admin/failed-notes"),
    ("post", "/api/admin/users/2/lock"),
    ("post", "/api/admin/users/2/unlock"),
]


@pytest.fixture
def ctx(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, database_url=database_url_for(tmp_path),
                        jwt_secret="test-secret", link_threshold=0.3)
    app = create_app(settings, embedder=FakeEmbedder(dim=1024), llm=FakeLLM("ok"),
                     stores=FakeStores(), mailer=FakeMailer())
    with TestClient(app) as c:
        conn = connect(settings.database)
        # id 1 = root (admin), 2 = alice, 3 = bob
        for name, role in (("root", "admin"), ("alice", "user"), ("bob", "user")):
            conn.execute("INSERT INTO users(username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                         (name, f"{name}@gmail.com", hash_password("pw-" + name), role))
        conn.commit()
        conn.close()
        yield c, settings


def login(client, name):
    r = client.post("/api/auth/login", data={"username": name, "password": "pw-" + name})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_normal_user_gets_403_on_every_admin_endpoint(ctx):
    client, _ = ctx
    h = login(client, "alice")
    for method, path in ADMIN_ENDPOINTS:
        r = getattr(client, method)(path, headers=h)
        assert r.status_code == 403, (path, r.status_code)


def test_anonymous_gets_401_on_admin_endpoints(ctx):
    client, _ = ctx
    for method, path in ADMIN_ENDPOINTS:
        assert getattr(client, method)(path).status_code == 401, path


def test_login_and_me_report_role(ctx):
    client, _ = ctx
    r = client.post("/api/auth/login", data={"username": "root", "password": "pw-root"})
    assert r.json()["role"] == "admin"
    assert client.get("/api/me", headers=login(client, "root")).json()["role"] == "admin"
    assert client.get("/api/me", headers=login(client, "alice")).json()["role"] == "user"


def test_admin_lists_users_without_password(ctx):
    client, _ = ctx
    users = client.get("/api/admin/users", headers=login(client, "root")).json()
    assert [u["username"] for u in users] == ["root", "alice", "bob"]
    assert all("password_hash" not in u for u in users)
    assert users[1]["is_active"] is True and users[0]["role"] == "admin"


def test_lock_blocks_login_and_kills_existing_token(ctx):
    client, _ = ctx
    admin = login(client, "root")
    alice = login(client, "alice")
    assert client.get("/api/notes", headers=alice).status_code == 200

    r = client.post("/api/admin/users/2/lock", headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    # token dang dung bi tu choi ngay, dang nhap lai cung bi chan
    assert client.get("/api/notes", headers=alice).status_code == 401
    r = client.post("/api/auth/login", data={"username": "alice", "password": "pw-alice"})
    assert r.status_code == 403 and "khóa" in r.json()["detail"]
    # sai mat khau van chi bao "sai mat khau" (khong lo tai khoan dang bi khoa)
    assert client.post("/api/auth/login", data={"username": "alice", "password": "sai"}).status_code == 401
    # bob khong bi anh huong
    assert client.get("/api/notes", headers=login(client, "bob")).status_code == 200

    assert client.post("/api/admin/users/2/unlock", headers=admin).json()["is_active"] is True
    assert client.get("/api/notes", headers=login(client, "alice")).status_code == 200


def test_admin_cannot_lock_self_or_other_admin_and_404(ctx):
    client, _ = ctx
    admin = login(client, "root")
    assert client.post("/api/admin/users/1/lock", headers=admin).status_code == 400
    assert client.post("/api/admin/users/999/lock", headers=admin).status_code == 404


def test_failed_notes_show_title_and_error_but_not_content(ctx):
    client, settings = ctx
    conn = connect(settings.database)
    conn.execute("INSERT INTO notes(user_id, title, content, status, error) VALUES (?, ?, ?, 'failed', ?)",
                 (2, "Bi mat", "NOI DUNG RIENG TU", "Lỗi embedding: hết bộ nhớ"))
    conn.execute("INSERT INTO notes(user_id, title, content, status) VALUES (?, ?, ?, 'ready')",
                 (3, "Binh thuong", "abc"))
    conn.commit()
    conn.close()

    r = client.get("/api/admin/failed-notes", headers=login(client, "root"))
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    item = items[0]
    assert item["title"] == "Bi mat" and item["username"] == "alice" and "hết bộ nhớ" in item["error"]
    assert "content" not in item and "NOI DUNG RIENG TU" not in r.text

    users = {u["username"]: u for u in client.get("/api/admin/users", headers=login(client, "root")).json()}
    assert users["alice"]["failed_count"] == 1 and users["bob"]["note_count"] == 1
