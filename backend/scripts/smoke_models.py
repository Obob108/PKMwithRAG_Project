"""Thu BGE-m3 va Gemini tren may that: python scripts/smoke_models.py [--skip-llm]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.services.embedding import Embedder  # noqa: E402
from app.services.llm import GeminiClient  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-llm", action="store_true")
    args = parser.parse_args()
    settings = get_settings()

    print("== Embedding ==")
    texts = [
        "Truy hồi tăng cường sinh văn bản dùng vector để tìm tài liệu liên quan.",
        "Retrieval-augmented generation uses vector search to find relevant documents.",
        "Công thức nấu phở bò với hành tây và quế.",
    ]
    try:
        vecs = Embedder(settings.embedding_model).encode(texts)
        print("shape:", vecs.shape, "| norm:", np.linalg.norm(vecs, axis=1).round(3))
        print("cosine vi-en  (nen cao):", float(vecs[0] @ vecs[1]).__round__(3))
        print("cosine vi-pho (nen thap):", float(vecs[0] @ vecs[2]).__round__(3))
    except Exception as exc:  # noqa: BLE001
        print("LOI embedding:", repr(exc))

    if args.skip_llm:
        return
    print("== Gemini ==", settings.gemini_model)
    try:
        reply = GeminiClient(settings.gemini_api_key, settings.gemini_model).generate(
            "Trả lời đúng một từ: OK"
        )
        print("tra loi:", reply.strip())
    except Exception as exc:  # noqa: BLE001
        print("LOI Gemini:", repr(exc))


if __name__ == "__main__":
    main()
