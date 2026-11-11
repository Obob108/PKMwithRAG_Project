"""Embedder va store gia de test logic lap chi muc ma khong can BGE-m3/FAISS."""
import re
import zlib

import numpy as np


class FakeEmbedder:
    """Bag-of-words hashing: van ban chung nhieu tu thi cosine cao."""

    def __init__(self, dim: int = 64):
        self.dim = dim
        self.calls = 0
        self.fail = False

    def encode(self, texts, batch_size: int = 16):
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        out = np.zeros((len(texts), self.dim), dtype="float32")
        for i, text in enumerate(texts):
            for tok in re.findall(r"\w+", text.lower()):
                out[i, zlib.crc32(tok.encode()) % self.dim] += 1
            norm = np.linalg.norm(out[i])
            if norm:
                out[i] /= norm
        return out


class FakeStore:
    def __init__(self):
        self.vectors: dict[int, np.ndarray] = {}
        self.saves = 0

    def __len__(self):
        return len(self.vectors)

    def add(self, ids, vectors):
        for i, v in zip(ids, vectors):
            self.vectors[int(i)] = np.asarray(v, dtype="float32")

    def remove(self, ids):
        for i in ids:
            self.vectors.pop(int(i), None)

    def search(self, query, k):
        scored = [(i, float(np.dot(query, v))) for i, v in self.vectors.items()]
        scored.sort(key=lambda t: -t[1])
        return scored[:k]

    def get_vector(self, chunk_id):
        return self.vectors[int(chunk_id)]

    def save(self):
        self.saves += 1


class FakeStores:
    def __init__(self):
        self._stores: dict[int, FakeStore] = {}

    def get(self, user_id):
        return self._stores.setdefault(user_id, FakeStore())


class FakeLLM:
    def __init__(self, reply: str = "Tra loi thu [1]."):
        self.reply = reply
        self.prompts: list[tuple[str, str | None]] = []

    def generate(self, prompt: str, system: str | None = None) -> str:
        self.prompts.append((prompt, system))
        return self.reply
