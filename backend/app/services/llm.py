"""Lop trung gian cho LLM. Doi nha cung cap = viet them mot class cung giao dien."""
import logging
from typing import Protocol

log = logging.getLogger(__name__)

# Ma loi tam thoi: qua tai (503), het han muc (429), loi may chu (500/504). Gap cac loi nay thi thu model du phong.
TRANSIENT_CODES = {429, 500, 503, 504}


class LLMBusy(Exception):
    """Moi model deu dang qua tai / het han muc. Nen thu lai sau."""


class LLMClient(Protocol):
    def generate(self, prompt: str, system: str | None = None) -> str: ...


def _code_of(exc: Exception) -> int | None:
    """Ma HTTP cua loi google-genai (APIError.code); None neu khong phai loi API."""
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


class GeminiClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash", temperature: float = 0.2,
                 fallbacks: list[str] | None = None):
        if not api_key:
            raise ValueError("Thieu GEMINI_API_KEY trong backend/.env")
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._models = [model] + [m for m in (fallbacks or []) if m and m != model]
        self._temperature = temperature

    def generate(self, prompt: str, system: str | None = None) -> str:
        from google.genai import types

        config = types.GenerateContentConfig(system_instruction=system, temperature=self._temperature)
        return self._generate_with_fallback(prompt, config)

    def _generate_with_fallback(self, prompt: str, config) -> str:
        """Thu lan luot model chinh roi cac model du phong; chi chuyen tiep khi loi tam thoi (qua tai, het han muc)."""
        last: Exception | None = None
        for model in self._models:
            try:
                response = self._client.models.generate_content(model=model, contents=prompt, config=config)
                return response.text or ""
            except Exception as e:  # noqa: BLE001
                code = _code_of(e)
                if code not in TRANSIENT_CODES:
                    raise  # sai key, sai ten model, mat mang...: bao loi that, khong che giau
                log.warning("Model %s tam thoi khong dung duoc (%s), thu model tiep theo", model, code)
                last = e
        raise LLMBusy(f"Tat ca model deu dang qua tai: {', '.join(self._models)}") from last
