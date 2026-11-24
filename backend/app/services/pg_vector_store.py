"""Chi muc vector bang pgvector: vector nam o cot chunks.embedding, cung bang voi noi dung chunk.

Cung giao dien voi FaissStore (add / remove / search / get_vector / save / __len__) nen indexer va truy hoi
khong can biet dang dung loai nao. Khac biet quan trong:
  - add(..., conn=conn) ghi vector bang CHINH ket noi cua indexer => chunk va vector cung mot transaction:
    loi giua chung thi rollback ca hai, khong con canh "SQLite va FAISS lech nhau" nhu ban cu.
  - Tim kiem CHINH XAC (khong tao chi muc HNSW): ket qua trung voi FAISS IndexFlatIP, nen so lieu danh gia
    giu nguyen. Vector da chuan hoa L2 nen tich vo huong = cosine; toan tu <#> cua pgvector tra ve
    -(tich vo huong) nen sap xep tang dan = giong nhat truoc.
"""
import numpy as np


def to_literal(vec) -> str:
    """Vector -> chuoi '[0.1,0.2,...]' cho kieu vector cua pgvector (9 chu so co nghia: du cho float32)."""
    return "[" + ",".join(f"{float(x):.9g}" for x in np.asarray(vec, dtype="float32").ravel()) + "]"


def from_literal(text: str) -> np.ndarray:
    return np.asarray([float(x) for x in text.strip("[]").split(",") if x], dtype="float32")


class PgVectorStore:
    def __init__(self, db, user_id: int, dim: int = 1024):
        self.db, self.user_id, self.dim = db, user_id, dim

    def __len__(self) -> int:
        with self.db.connection() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM chunks WHERE user_id = ? AND embedding IS NOT NULL", (self.user_id,)
            ).fetchone()[0]

    def _write(self, conn, ids, vectors) -> None:
        for cid, vec in zip(ids, vectors):
            conn.execute("UPDATE chunks SET embedding = CAST(? AS vector) WHERE id = ? AND user_id = ?",
                         (to_literal(vec), int(cid), self.user_id))

    def add(self, ids: list[int], vectors: np.ndarray, conn=None) -> None:
        if not ids:
            return
        if conn is not None:  # trong transaction cua nguoi goi (indexer): nguoi goi commit
            self._write(conn, ids, vectors)
            return
        with self.db.connection() as own:
            self._write(own, ids, vectors)
            own.commit()

    def remove(self, ids: list[int], conn=None) -> None:
        """Chunk bi xoa thi vector mat theo (cung dong). Chi can xoa vector cua chunk van con."""
        if not ids:
            return
        marks = ",".join("?" * len(ids))
        sql = f"UPDATE chunks SET embedding = NULL WHERE user_id = ? AND id IN ({marks})"
        if conn is not None:
            conn.execute(sql, (self.user_id, *map(int, ids)))
            return
        with self.db.connection() as own:
            own.execute(sql, (self.user_id, *map(int, ids)))
            own.commit()

    def search(self, query: np.ndarray, k: int) -> list[tuple[int, float]]:
        """[(chunk_id, cosine)] giam dan; tim chinh xac tren cac chunk cua nguoi dung nay."""
        if k <= 0:
            return []
        q = to_literal(query)
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT id, -(embedding <#> CAST(? AS vector)) AS score FROM chunks "
                "WHERE user_id = ? AND embedding IS NOT NULL "
                "ORDER BY embedding <#> CAST(? AS vector), id LIMIT ?",
                (q, self.user_id, q, int(k)),
            ).fetchall()
        return [(int(r[0]), float(r[1])) for r in rows]

    def get_vector(self, chunk_id: int) -> np.ndarray:
        with self.db.connection() as conn:
            row = conn.execute("SELECT CAST(embedding AS text) FROM chunks WHERE id = ? AND user_id = ?",
                               (int(chunk_id), self.user_id)).fetchone()
        if row is None or row[0] is None:
            raise KeyError(chunk_id)
        return from_literal(row[0])

    def save(self) -> None:
        """Khong can: vector da nam trong CSDL va duoc commit cung giao dich."""


class PgVectorStores:
    def __init__(self, db, dim: int = 1024):
        self.db, self.dim = db, dim
        self._ready = False

    def ensure_schema(self) -> None:
        """Bat extension pgvector va them cot embedding (idempotent). Can quyen tao extension lan dau."""
        with self.db.connection() as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.execute(f"ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector({int(self.dim)})")
            conn.commit()
        self._ready = True

    def get(self, user_id: int) -> PgVectorStore:
        if not self._ready:  # script chay doc lap (khong qua lifespan cua app) van co cot embedding
            self.ensure_schema()
        return PgVectorStore(self.db, user_id, self.dim)
