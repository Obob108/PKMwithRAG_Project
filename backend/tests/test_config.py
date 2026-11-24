"""ENVIRONMENT=production: khong khoi dong voi cau hinh khong an toan (can pydantic-settings)."""
import pytest

pytest.importorskip("pydantic_settings")

from app.core.config import Settings, check_production, config_problems  # noqa: E402

STRONG = "x" * 48


def test_development_only_warns():
    s = Settings(_env_file=None, jwt_secret="change-me")
    assert config_problems(s)
    check_production(s)  # khong nem loi o moi truong phat trien


def test_production_refuses_weak_secret_and_default_db_password():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        check_production(Settings(_env_file=None, environment="production", jwt_secret="ngan"))
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        check_production(Settings(_env_file=None, environment="production", jwt_secret=STRONG,
                                  database_url="postgresql://pkm:pkm@127.0.0.1:5433/pkm"))
    check_production(Settings(_env_file=None, environment="production", jwt_secret=STRONG,
                              database_url="postgresql://pkm:mat-khau-rieng@127.0.0.1:5433/pkm"))
