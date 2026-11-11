import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .core.config import Settings, get_settings
from .core.db import connect, init_db
from .core.ratelimit import RateLimiter
from .services.embedding import Embedder
from .services.vector_store import VectorStores

log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, *, embedder=None, llm=None, stores=None) -> FastAPI:
    """Nhan embedder/llm/stores tu ngoai de test (embedder gia, LLM gia, store gia)."""
    settings = settings or get_settings()
    real_embedder = embedder is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        conn = connect(settings.db_path)
        init_db(conn)
        conn.close()
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        if settings.jwt_secret == "change-me":
            log.warning("JWT_SECRET dang la gia tri mac dinh; dat mot chuoi ngau nhien dai trong .env")
        if real_embedder:  # nap BGE-m3 san o luong nen de lan lap chi muc dau khong phai cho
            threading.Thread(target=app.state.embedder.encode, args=(["khoi dong"],), daemon=True).start()
        yield

    app = FastAPI(title="Personal Knowledge App", lifespan=lifespan)
    app.state.settings = settings
    app.state.embedder = embedder or Embedder(settings.embedding_model)
    app.state.stores = stores or VectorStores(settings.faiss_dir)
    app.state.llm = llm
    app.state.locks = {}
    app.state.login_limiter = RateLimiter(limit=10, window=300)   # chi dem lan dang nhap SAI
    app.state.register_limiter = RateLimiter(limit=5, window=3600)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
