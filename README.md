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
python scripts/create_user.py alice --email alice@gmail.com
python scripts/import_folder.py --user alice --dir "C:\duong\dan\thu_muc_ghi_chu"
```
Tiêu đề ghi chú = tên file (không có đuôi), khớp với [[wiki-link]] kiểu Obsidian.

## Tài khoản quản trị (admin)

Admin đăng nhập ở **cùng màn hình đăng nhập**; nếu tài khoản có `role = admin` thì vào thẳng trang quản trị
(danh sách tài khoản, khóa / mở khóa, ghi chú lập chỉ mục lỗi: chỉ tiêu đề + lỗi, không xem được nội dung).
Không có API tự cấp quyền admin, chỉ cấp được từ máy chủ:

```powershell
python scripts/create_user.py root --email root@gmail.com --admin   # tạo admin mới
python scripts/make_admin.py alice                                   # nâng tài khoản có sẵn
python scripts/make_admin.py alice --revoke                          # thu quyền
```

API: `GET /api/admin/users`, `POST /api/admin/users/{id}/lock` | `/unlock`, `GET /api/admin/failed-notes`.
Người dùng thường gọi `/api/admin/*` nhận **403**, chưa đăng nhập nhận **401**. Tài khoản bị khóa: token
đang dùng hết hiệu lực ngay, đăng nhập lại nhận 403 "Tài khoản đã bị khóa".

## Hỏi đáp và chọn ngưỡng τ
```
python scripts/ask.py --user alice "RAG khác gì với semantic linking?"
python scripts/ask.py --user alice "..." --compare        # so vector thuần và truy hồi lai, không gọi LLM
python scripts/ask.py --user alice "..." --graph-weight 0.5
python scripts/sample_links.py --user alice --n 60 --out ../eval/link_sample.csv
```
`sample_links.py` in phân bố cosine giữa các chunk khác ghi chú và ghi file CSV để bạn tự gán nhãn (cột `label`: 1 = thật sự liên quan, 0 = không).

Nhãn ✓ / ✗ bấm trong panel "Liên kết" của ứng dụng cũng là dữ liệu đánh giá: `python scripts/link_precision.py --user alice --out ../eval/link_decisions.csv`
in precision của gợi ý theo từng ngưỡng τ (chỉ đo được τ ≥ `link_threshold` lúc lập chỉ mục, và theo cặp ghi chú chứ không theo cặp chunk).

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

## PostgreSQL + pgvector (thay SQLite + FAISS)
Mặc định backend dùng SQLite + FAISS (không cần cài gì thêm). Để dùng PostgreSQL 16 + pgvector (cần Docker Desktop):
```
docker compose up -d db                     # ở thư mục gốc; lần đầu tải image pgvector/pgvector:pg16
cd backend
pip install -r requirements.txt             # thêm psycopg
```
Thêm vào `backend/.env`: `DATABASE_URL=postgresql://pkm:pkm@127.0.0.1:5433/pkm` rồi khởi động lại uvicorn
(schema, extension `vector` và cột `chunks.embedding` tự tạo khi khởi động).

Chép dữ liệu đang có trong SQLite + FAISS sang (giữ nguyên id; chạy một lần, CSDL đích phải rỗng):
```
python scripts/migrate_sqlite_to_pg.py --pg postgresql://pkm:pkm@127.0.0.1:5433/pkm
```
Chạy bộ test trên PostgreSQL (CSDL `pkm_test` riêng, bị xóa sạch mỗi test):
```
$env:TEST_DATABASE_URL = "postgresql://pkm:pkm@127.0.0.1:5433/pkm_test"
python -m pytest
Remove-Item Env:TEST_DATABASE_URL           # quay về chạy test trên SQLite
```
Khác biệt khi chạy PostgreSQL: connection pool (`DB_POOL_SIZE`), đồng bộ trực tiếp bằng LISTEN/NOTIFY (không còn
hỏi CSDL mỗi giây), vector nằm chung bảng `chunks` và ghi cùng transaction với nội dung.

## Triển khai lên VPS (ghi chú)
- `backend/.env`: `ENVIRONMENT=production`, `JWT_SECRET` dài ngẫu nhiên, đổi mật khẩu PostgreSQL trong
  `docker-compose.yml` và `DATABASE_URL` (backend từ chối khởi động nếu còn cấu hình mặc định).
- Đặt Nginx/Caddy (HTTPS) trước uvicorn và gửi header `X-Forwarded-For`. uvicorn mặc định tin header này từ
  127.0.0.1 (`--forwarded-allow-ips`), nhờ đó giới hạn đăng nhập/đăng ký tính đúng theo IP người dùng chứ không
  phải IP của Nginx.
- Sao lưu hằng ngày: `bash backend/scripts/backup.sh` (pg_dump + thư mục uploads, giữ 14 ngày; cách đặt cron và
  khôi phục ghi ở đầu file).
- Dọn ảnh không còn ghi chú nào dùng: `python scripts/cleanup_attachments.py` (liệt kê), thêm `--apply` để xóa.
