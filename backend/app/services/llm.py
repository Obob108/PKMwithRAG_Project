"""Lop trung gian cho LLM. Doi nha cung cap = viet them mot class cung giao dien."""
from typing import Protocol


class LLMClient(Protocol):
    def generate(self, prompt: str, system: str | None = None) -> str: ...


class GeminiClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash", temperature: float = 0.2):
        if not api_key:
            raise ValueError("Thieu GEMINI_API_KEY trong backend/.env")
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._temperature = temperature

    def generate(self, prompt: str, system: str | None = None) -> str:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system, temperature=self._temperature
            ),
        )
        return response.text or ""
