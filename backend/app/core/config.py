from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_dir: Path = Path("../data")
    # Trong = SQLite (data_dir/app.db) + FAISS. Dat postgresql://user:matkhau@host:5432/ten_csdl de dung PostgreSQL;
    # khi do VECTOR_BACKEND mac dinh la pgvector (vector nam chung bang chunks).
    database_url: str = ""
    db_pool_size: int = 10
    vector_backend: str = ""  # "" = tu chon (pgvector neu PostgreSQL, faiss neu SQLite) | "faiss" | "pgvector"

    # Models
    embedding_model: str = "BAAI/bge-m3"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"  # doi trong .env neu model nay khong con
    # Model du phong (cach nhau dau phay), dung khi model chinh qua tai (503) / het han muc (429). De trong = khong co.
    gemini_fallback_models: str = ""

    @property
    def gemini_fallbacks(self) -> list[str]:
        return [m.strip() for m in self.gemini_fallback_models.split(",") if m.strip()]

    # Auth
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 60 * 24 * 7

    # Dang ky: tat hoac yeu cau ma moi khi trien khai that
    allow_registration: bool = True
    invite_code: str = ""

    # hCaptcha: dat CA HAI de bat (bat buoc giai captcha khi dang nhap/dang ky); de trong = tat
    hcaptcha_sitekey: str = ""
    hcaptcha_secret: str = ""

    # Email (gui ma OTP quen mat khau). Gmail: SMTP_USER = dia chi Gmail, SMTP_PASSWORD = App Password 16 ky tu
    # (bat xac minh 2 buoc roi tao tai https://myaccount.google.com/apppasswords). De trong = in email ra log.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    reset_code_minutes: int = 10
    reset_max_attempts: int = 5

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_user and self.smtp_password)

    @property
    def captcha_enabled(self) -> bool:
        return bool(self.hcaptcha_sitekey and self.hcaptcha_secret)

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
    def database(self) -> str:
        """Dich ket noi thuc te: DATABASE_URL neu co, nguoc lai file SQLite."""
        return self.database_url or str(self.db_path)

    @property
    def uses_postgres(self) -> bool:
        return self.database.startswith(("postgresql://", "postgres://"))

    @property
    def vectors(self) -> str:
        return self.vector_backend or ("pgvector" if self.uses_postgres else "faiss")

    @property
    def faiss_dir(self) -> Path:
        return self.data_dir / "faiss"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
