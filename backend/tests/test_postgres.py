"""Thanh phan rieng cua PostgreSQL: doi cu phap tham so, connection pool, LISTEN/NOTIFY, pgvector.

translate() chay o moi noi; phan con lai can TEST_DATABASE_URL (xem tests/dbutil.py). Phan pgvector can them
extension `vector` (image Docker pgvector/pgvector), thieu thi bo qua.
"""
import asyncio

import numpy as np
import pytest

from app.core.db import Database, connect
from app.core.pg import translate
from app.services import notes
from tests.dbutil import TEST_PG, fresh_conn, reset_pg

needs_pg = pytest.mark.skipif(not TEST_PG, reason="can TEST_DATABASE_URL tro toi PostgreSQL")


def test_translate_placeholders_outside_quotes_only():
    assert translate("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?") == \
        "SELECT * FROM t WHERE a = %s AND b = '?' AND c = %s"
    assert translate("SELECT '50%' AS p, ? AS x") == "SELECT '50%%' AS p, %s AS x"
    assert translate('SELECT "co?l" FROM t WHERE x = ?') == 'SELECT "co?l" FROM t WHERE x = %s'


@needs_pg
def test_rows_read_by_name_and_position_and_timestamps_are_text():
    conn = fresh_conn()
    uid = conn.execute("INSERT INTO users(username, password_hash) VALUES (?, 'x') RETURNING id", ("an",)).fetchone()[0]
    row = conn.execute("SELECT id, username, created_at FROM users WHERE id = ?", (uid,)).fetchone()
    assert row["username"] == row[1] == "an"
    assert isinstance(row["created_at"], str) and len(row["created_at"]) == 19  # 'YYYY-MM-DD HH:MM:SS' (UTC)
    conn.close()


@needs_pg
def test_pool_reuses_connections_and_rolls_back_unfinished_work():
    reset_pg(TEST_PG)
    db = Database(TEST_PG, pool_size=2)
    db.init()
    with db.connection() as c1:
        c1.execute("INSERT INTO users(username, password_hash) VALUES ('khong-commit', 'x')")  # quen commit
        first = id(c1.raw)
    with db.connection() as c2:
        assert id(c2.raw) == first  # dung lai ket noi cu, khong mo moi
        assert c2.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0  # phan do dang da bi rollback
    with db.connection() as a, db.connection() as b:
        assert a is not b
    assert db.pool.size == 2
    db.close()


@needs_pg
def test_pool_waits_then_times_out_when_exhausted():
    reset_pg(TEST_PG)
    db = Database(TEST_PG, pool_size=1)
    db.pool.timeout = 0.2
    with db.connection():
        with pytest.raises(TimeoutError):
            with db.connection():
                pass
    db.close()


@needs_pg
def test_event_hub_wakes_only_on_commit_and_only_the_right_user():
    from app.services.event_hub import EventHub

    reset_pg(TEST_PG)
    db = Database(TEST_PG)
    db.init()
    with db.connection() as conn:
        for name in ("an", "binh"):
            conn.execute("INSERT INTO users(username, password_hash) VALUES (?, 'x')", (name,))
        conn.commit()
    hub = EventHub(TEST_PG, poll_timeout=0.2)
    hub.start()
    assert hub.connected.wait(5)

    async def scenario():
        ev_an, ev_binh = hub.subscribe(1), hub.subscribe(2)
        await asyncio.sleep(0.3)
        ev_an.clear(), ev_binh.clear()  # bo lan danh thuc khi vua ket noi
        with db.connection() as conn:  # rollback: khong ai duoc bao
            conn.execute("INSERT INTO events(user_id, type, note_id, version) VALUES (1, 'created', 1, 1)")
            conn.rollback()
        await asyncio.sleep(0.6)
        assert not ev_an.is_set()
        with db.connection() as conn:  # commit: chi nguoi dung 1 duoc bao
            notes.create_note(conn, 1, "Ghi chu", "noi dung")
        await asyncio.wait_for(ev_an.wait(), timeout=3)
        assert not ev_binh.is_set()
        hub.unsubscribe(1, ev_an), hub.unsubscribe(2, ev_binh)
        assert hub.subscriber_count() == 0

    try:
        asyncio.run(scenario())
    finally:
        hub.stop()
        db.close()


def _has_pgvector() -> bool:
    if not TEST_PG:
        return False
    try:  # khong ket noi duoc: de cac test khac bao loi ro rang, khong lam hong ca luot thu thap test
        conn = connect(TEST_PG)
        ok = conn.execute("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'").fetchone() is not None
        conn.close()
        return ok
    except Exception:  # noqa: BLE001
        return False


@pytest.mark.skipif(not _has_pgvector(), reason="can extension pgvector (image pgvector/pgvector)")
def test_pgvector_store_matches_exact_inner_product_search_and_is_transactional():
    from app.services.pg_vector_store import PgVectorStores

    reset_pg(TEST_PG)
    db = Database(TEST_PG)
    db.init()
    stores = PgVectorStores(db, dim=4)
    with db.connection() as conn:
        conn.execute("INSERT INTO users(username, password_hash) VALUES ('an', 'x')")
        note = notes.create_note(conn, 1, "A", "x")
        ids = [conn.execute("INSERT INTO chunks(note_id, user_id, idx, text) VALUES (?, 1, ?, 't') RETURNING id",
                            (note["id"], i)).fetchone()[0] for i in range(3)]
        conn.commit()
    vecs = np.eye(4, dtype="float32")[:3]
    store = stores.get(1)
    with db.connection() as conn:  # ghi trong giao dich roi rollback: khong luu gi
        store.add(ids, vecs, conn=conn)
        conn.rollback()
    assert len(store) == 0
    store.add(ids, vecs)
    q = np.array([0.9, 0.1, 0, 0], dtype="float32")
    hits = store.search(q, 2)
    assert [h[0] for h in hits] == [ids[0], ids[1]]
    assert hits[0][1] == pytest.approx(0.9, abs=1e-6)
    assert np.allclose(store.get_vector(ids[2]), vecs[2])
    db.close()
