"""Kiem thu chuyen sang model du phong khi model chinh qua tai (khong goi API that)."""
import pytest

from app.services.llm import GeminiClient, LLMBusy


class ApiErr(Exception):
    def __init__(self, code):
        super().__init__(f"HTTP {code}")
        self.code = code


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = outcomes  # model -> so ma loi hoac chuoi tra loi
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        out = self.outcomes[model]
        if isinstance(out, int):
            raise ApiErr(out)
        return type("R", (), {"text": out})()


def client(models, outcomes):
    c = GeminiClient.__new__(GeminiClient)  # bo qua __init__ (khong can google-genai, khong can key)
    c._client = type("C", (), {"models": FakeModels(outcomes)})()
    c._models = models
    c._temperature = 0.2
    return c


def test_falls_back_when_primary_overloaded():
    c = client(["a", "b"], {"a": 503, "b": "tra loi tu b"})
    assert c._generate_with_fallback("q", None) == "tra loi tu b"
    assert c._client.models.calls == ["a", "b"]


def test_rate_limit_also_falls_back_and_all_busy_raises():
    c = client(["a", "b"], {"a": 429, "b": 503})
    with pytest.raises(LLMBusy):
        c._generate_with_fallback("q", None)


def test_non_transient_errors_are_not_hidden():
    c = client(["a", "b"], {"a": 400, "b": "khong duoc goi"})
    with pytest.raises(ApiErr):
        c._generate_with_fallback("q", None)
    assert c._client.models.calls == ["a"]


def test_primary_ok_does_not_touch_fallback():
    c = client(["a", "b"], {"a": "ok", "b": 503})
    assert c._generate_with_fallback("q", None) == "ok"
    assert c._client.models.calls == ["a"]
