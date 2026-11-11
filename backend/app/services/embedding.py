"""BGE-m3 qua sentence-transformers. Nap model lan dau khi can (lazy)."""
import threading

import numpy as np


class Embedder:
    def __init__(self, model_name: str = "BAAI/bge-m3", max_seq_length: int = 512):
        self.model_name = model_name
        self.max_seq_length = max_seq_length
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:  # tranh nap hai lan khi warm-up va tac vu nen chay cung luc
            if self._model is None:
                from sentence_transformers import SentenceTransformer

                model = SentenceTransformer(self.model_name)
                model.max_seq_length = self.max_seq_length
                self._model = model
        return self._model

    def encode(self, texts: list[str], batch_size: int = 16) -> np.ndarray:
        """Tra ve ma tran float32 (n, dim), da chuan hoa L2 (cosine = inner product)."""
        if not texts:
            return np.zeros((0, 1024), dtype="float32")
        vectors = self._load().encode(
            texts, batch_size=batch_size, normalize_embeddings=True, show_progress_bar=False
        )
        return np.asarray(vectors, dtype="float32")
