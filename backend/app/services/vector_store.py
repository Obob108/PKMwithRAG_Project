"""Chi muc vector FAISS, mot file cho moi user.

IndexIDMap2(IndexFlatIP): vector da chuan hoa L2 nen inner product = cosine.
ID trong FAISS chinh la chunks.id trong SQLite.
"""
import os
import threading
from pathlib import Path

import numpy as np


class FaissStore:
    def __init__(self, path: str | Path, dim: int = 1024):
        import faiss  # nap tre de cac module khac import duoc khi chua cai faiss

        self._faiss = faiss
        self.path = Path(path)
        self.dim = dim
        self._lock = threading.RLock()
        if self.path.exists():
            self._index = faiss.read_index(str(self.path))
        else:
            self._index = faiss.IndexIDMap2(faiss.IndexFlatIP(dim))

    def __len__(self) -> int:
        return self._index.ntotal

    def add(self, ids: list[int], vectors: np.ndarray) -> None:
        if not ids:
            return
        vectors = np.ascontiguousarray(vectors, dtype="float32")
        with self._lock:
            self._index.add_with_ids(vectors, np.asarray(ids, dtype="int64"))

    def remove(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock:
            self._index.remove_ids(np.asarray(ids, dtype="int64"))

    def search(self, query: np.ndarray, k: int) -> list[tuple[int, float]]:
        """Tra ve [(chunk_id, cosine)] giam dan theo diem."""
        with self._lock:
            n = self._index.ntotal
            if n == 0 or k <= 0:
                return []
            q = np.ascontiguousarray(query, dtype="float32").reshape(1, -1)
            scores, ids = self._index.search(q, min(k, n))
        return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1]

    def get_vector(self, chunk_id: int) -> np.ndarray:
        with self._lock:
            return self._index.reconstruct(int(chunk_id))

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            self._faiss.write_index(self._index, str(tmp))
            os.replace(tmp, self.path)


class VectorStores:
    """Quan ly cac FaissStore theo user_id (moi user mot file rieng)."""

    def __init__(self, directory: str | Path, dim: int = 1024):
        self.directory = Path(directory)
        self.dim = dim
        self._stores: dict[int, FaissStore] = {}
        self._lock = threading.Lock()

    def get(self, user_id: int) -> FaissStore:
        with self._lock:
            if user_id not in self._stores:
                path = self.directory / f"user_{user_id}.index"
                self._stores[user_id] = FaissStore(path, self.dim)
            return self._stores[user_id]
