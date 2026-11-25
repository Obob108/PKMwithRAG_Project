import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.admin import router as admin_router
from .api.routes import router
from .core.config import Settings, check_production, config_problems, get_settings
from .core.db import Database
from .core.ratelimit import RateLimiter
from .services.embedding import Embedder
from .services.mailer import ConsoleMailer, SmtpMailer
from .services.event_hub import EventHub
from .services.vector_store import make_vector_stores

log = logging.getLogger(__name__)


def _make_mailer(settings: Settings):
    if settings.smtp_enabled:
        return SmtpMailer(settings.smtp_host, settings.smtp_port, settings.smtp_user, settings.smtp_password,
                          settings.smtp_from or None)
    log.warning("Chua cau hinh SMTP_USER/SMTP_PASSWORD: ma quen mat khau se duoc in ra log thay vi gui email")
    return ConsoleMailer()


def create_app(settings: Settings | None = None, *, embedder=None, llm=None, stores=None,
               mailer=None) -> FastAPI:
    """Nhan embedder/llm/stores/mailer tu ngoai de test (ban gia)."""
    settings = settings or get_settings()
    check_production(settings)  # ENVIRONMENT=production ma cau hinh khong an toan -> khong khoi dong
    real_embedder = embedder is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = app.state.db
        db.init()  # tao / nang cap schema
        ensure = getattr(app.state.stores, "ensure_schema", None)
        if ensure:  # pgvector: bat extension + cot embedding
            ensure()
        if db.is_postgres:  # dong bo truc tiep bang LISTEN/NOTIFY thay vi hoi CSDL moi giay
            app.state.event_hub = EventHub(db.target)
            app.state.event_hub.start()
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        for problem in config_problems(settings):  # moi truong phat trien: chi canh bao
            log.warning(problem)
        if real_embedder:  # nap BGE-m3 san o luong nen de lan lap chi muc dau khong phai cho
            threading.Thread(target=app.state.embedder.encode, args=(["khoi dong"],), daemon=True).start()
        yield
        if app.state.event_hub is not None:
            app.state.event_hub.stop()
        db.close()

    app = FastAPI(title="Personal Knowledge App", lifespan=lifespan)
    app.state.settings = settings
    app.state.embedder = embedder or Embedder(settings.embedding_model)
    app.state.db = Database(settings.database, pool_size=settings.db_pool_size)
    app.state.stores = stores or make_vector_stores(settings, app.state.db)
    app.state.event_hub = None
    app.state.llm = llm
    app.state.locks = {}
    app.state.login_limiter = RateLimiter(limit=10, window=300)   # chi dem lan dang nhap SAI
    app.state.register_limiter = RateLimiter(limit=5, window=3600)
    app.state.reset_limiter = RateLimiter(limit=5, window=900)       # nhap SAI ma OTP: 5 lan/15 phut/IP
    app.state.forgot_ip_limiter = RateLimiter(limit=10, window=3600)  # xin ma: 10 lan/gio/IP
    app.state.forgot_email_limiter = RateLimiter(limit=3, window=3600)  # xin ma: 3 lan/gio/email
    app.state.mailer = mailer or _make_mailer(settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)
    app.include_router(admin_router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
