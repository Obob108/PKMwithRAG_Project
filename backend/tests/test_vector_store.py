"""Can cai faiss-cpu; tu dong bo qua neu chua co."""
import numpy as np
import pytest

faiss = pytest.importorskip("faiss")

from app.services.vector_store import FaissStore, VectorStores  # noqa: E402


def _unit(*xs):
    v = np.array(xs, dtype="float32")
    return v / np.linalg.norm(v)


def test_add_search_remove(tmp_path):
    store = FaissStore(tmp_path / "u.index", dim=3)
    store.add([10, 20, 30], np.stack([_unit(1, 0, 0), _unit(1, 1, 0), _unit(0, 0, 1)]))
    hits = store.search(_unit(1, 0, 0), 2)
    assert [h[0] for h in hits] == [10, 20]
    assert hits[0][1] == pytest.approx(1.0, abs=1e-5)
    store.remove([10])
    assert len(store) == 2
    assert 10 not in [h[0] for h in store.search(_unit(1, 0, 0), 3)]


def test_search_empty_and_k_larger_than_size(tmp_path):
    store = FaissStore(tmp_path / "u.index", dim=3)
    assert store.search(_unit(1, 0, 0), 5) == []
    store.add([1], np.stack([_unit(1, 0, 0)]))
    assert len(store.search(_unit(1, 0, 0), 5)) == 1


def test_save_and_reload(tmp_path):
    path = tmp_path / "sub" / "u.index"
    store = FaissStore(path, dim=3)
    store.add([7], np.stack([_unit(0, 1, 0)]))
    store.save()
    again = FaissStore(path, dim=3)
    assert len(again) == 1
    assert again.search(_unit(0, 1, 0), 1)[0][0] == 7
    assert np.allclose(again.get_vector(7), _unit(0, 1, 0), atol=1e-5)


def test_vector_stores_are_per_user(tmp_path):
    stores = VectorStores(tmp_path, dim=3)
    a, b = stores.get(1), stores.get(2)
    assert a is stores.get(1) and a is not b
    a.add([1], np.stack([_unit(1, 0, 0)]))
    assert len(b) == 0
