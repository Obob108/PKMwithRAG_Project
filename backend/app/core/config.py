from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_dir: Path = Path("../data")

    # Models
    embedding_model: str = "BAAI/bge-m3"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"  # doi trong .env neu model nay khong con

    # Auth
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 60 * 24 * 7

    # Dang ky: tat hoac yeu cau ma moi khi trien khai that
    allow_registration: bool = True
    invite_code: str = ""

    # Semantic linking (tau phai chinh bang thuc nghiem, xem SPEC.md muc 4)
    link_top_k: int = 5
    link_threshold: float = 0.65

    # Web
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_mb: int = 10
    sse_max_seconds: int = 300

    # Chat: mac dinh vector thuan (ket qua danh gia: do thi chua chung minh duoc loi ich)
    chat_use_graph: bool = False
    chat_graph_slots: int = 1

    # Hybrid retrieval
    retrieve_top_k: int = 8
    context_top_k: int = 5
    rrf_k: int = 60

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def faiss_dir(self) -> Path:
        return self.data_dir / "faiss"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
