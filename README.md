# Personal Knowledge App

Xem SPEC.md de biet pham vi va thiet ke.

## Chay backend (Windows PowerShell)
```
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # roi dien GEMINI_API_KEY va JWT_SECRET
uvicorn app.main:app --reload
```
Mo http://127.0.0.1:8000/health va http://127.0.0.1:8000/docs

## Chay test
```
cd backend
pytest
```

## Thử model thật (cần mạng, lần đầu tải BGE-m3 khoảng 2 GB)
```
python scripts/smoke_models.py
```

## Tạo user và nhập thư mục ghi chú
```
python scripts/create_user.py alice
python scripts/import_folder.py --user alice --dir "C:\duong\dan\thu_muc_ghi_chu"
```
Tiêu đề ghi chú = tên file (không có đuôi), khớp với [[wiki-link]] kiểu Obsidian.

## Hỏi đáp và chọn ngưỡng τ
```
python scripts/ask.py --user alice "RAG khác gì với semantic linking?"
python scripts/ask.py --user alice "..." --compare        # so vector thuần và truy hồi lai, không gọi LLM
python scripts/ask.py --user alice "..." --graph-weight 0.5
python scripts/sample_links.py --user alice --n 60 --out ../eval/link_sample.csv
```
`sample_links.py` in phân bố cosine giữa các chunk khác ghi chú và ghi file CSV để bạn tự gán nhãn (cột `label`: 1 = thật sự liên quan, 0 = không).

## Đánh giá truy hồi
Tạo `eval/questions.jsonl` (xem `eval/questions.example.jsonl`), rồi:
```
python scripts/run_eval.py --user alice --questions ../eval/questions.jsonl --weights 0.25,0.5,1.0
```
In bảng R@3, R@5, MRR, all@5 cho vector thuần và truy hồi lai, tách theo loại câu hỏi (direct/multi), và ghi chi tiết từng câu vào `eval/results.csv`.

## Chạy API và đăng nhập thử
```
python -c "import secrets; print(secrets.token_urlsafe(48))"    # dán kết quả vào JWT_SECRET trong .env
uvicorn app.main:app --reload
```
Mở http://127.0.0.1:8000/docs, bấm **Authorize**, nhập username/password (tạo bằng `scripts/create_user.py`),
rồi thử `POST /api/notes`, `PUT /api/notes/{id}` (với base_version), `POST /api/chat`.
Lần chạy đầu, cơ sở dữ liệu cũ tự được nâng lên schema v2 (giữ nguyên ghi chú, chunk, liên kết).

## Chạy giao diện web (cần Node 20+)
```
cd frontend
npm install
npm run dev            # mở http://localhost:5173 (tự chuyển /api sang backend ở cổng 8000)
npm test               # test thư viện đồng bộ/gộp/markdown/graph
```
Chạy backend ở một cửa sổ khác (`uvicorn app.main:app --reload` trong thư mục `backend`). Trên trang đăng nhập bạn có thể
**Đăng ký** tài khoản mới hoặc dùng tài khoản tạo bằng `create_user.py`. Muốn thử trên điện thoại cùng Wi-Fi:
`npm run dev -- --host`, rồi mở `http://<IP máy tính>:5173` (thêm IP đó vào `CORS_ORIGINS` chỉ cần khi KHÔNG đi qua proxy của Vite).

Biến môi trường mới trong `backend/.env`: `ALLOW_REGISTRATION=true|false`, `INVITE_CODE=<mã mời, để trống = không yêu cầu>`.
Sau khi nạp ghi chú bằng `import_folder.py`, các PDF được giữ lại bản gốc để mở trong ứng dụng (cơ sở dữ liệu tự nâng lên schema v3).
