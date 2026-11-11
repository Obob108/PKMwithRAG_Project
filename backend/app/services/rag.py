"""Sinh cau tra loi RAG tu cac chunk truy hoi duoc, kem danh sach nguon."""
from .retrieval import Hit, retrieve

SYSTEM_PROMPT = (
    "Bạn là trợ lý hỏi đáp trên ghi chú cá nhân của người dùng.\n"
    "- Chỉ trả lời dựa trên các đoạn trích trong phần NGỮ CẢNH. Không dùng kiến thức bên ngoài.\n"
    "- Sau mỗi ý, ghi nguồn bằng số trong ngoặc vuông, ví dụ [1] hoặc [2][3].\n"
    "- Nếu ngữ cảnh không đủ để trả lời, nói rõ là không tìm thấy trong ghi chú; đừng suy đoán.\n"
    "- Trả lời bằng đúng ngôn ngữ của câu hỏi, ngắn gọn, rõ ràng."
)

NO_CONTEXT_ANSWER = "Không tìm thấy thông tin liên quan trong ghi chú của bạn."


def build_context(hits: list[Hit]) -> str:
    blocks = []
    for n, h in enumerate(hits, start=1):
        where = h.title + (f" › {h.heading}" if h.heading else "")
        blocks.append(f"[{n}] ({where})\n{h.text}")
    return "\n\n".join(blocks)


def build_prompt(question: str, hits: list[Hit]) -> str:
    return f"NGỮ CẢNH:\n{build_context(hits)}\n\nCÂU HỎI: {question}"


def source_list(hits: list[Hit]) -> list[dict]:
    return [
        {
            "n": n,
            "note_id": h.note_id,
            "chunk_id": h.chunk_id,
            "title": h.title,
            "heading": h.heading,
            "via": h.via,
            "score": round(h.score, 5),
            "vector_score": round(h.vector_score, 3),
            "snippet": h.text[:160],
        }
        for n, h in enumerate(hits, start=1)
    ]


def answer_question(conn, store, embedder, llm, user_id: int, question: str, **retrieve_kwargs) -> dict:
    hits = retrieve(conn, store, embedder, user_id, question, **retrieve_kwargs)
    if not hits:
        return {"answer": NO_CONTEXT_ANSWER, "sources": [], "hits": []}
    answer = llm.generate(build_prompt(question, hits), system=SYSTEM_PROMPT)
    return {"answer": answer.strip(), "sources": source_list(hits), "hits": hits}
