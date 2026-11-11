# SPEC: Ứng dụng quản lý tri thức cá nhân tích hợp liên kết ngữ nghĩa và hỏi đáp RAG

> Dán file này vào đầu mỗi cuộc trò chuyện mới với AI để nó nắm lại phạm vi và quyết định.

## 1. Tổng quan
Ứng dụng web: ghi chú Markdown + tải lên PDF text. Hệ thống tự động:
1. Liên kết ghi chú theo ngữ nghĩa (đóng góp 1).
2. Trả lời câu hỏi bằng RAG, truy hồi lai có đồ thị liên kết (đóng góp 2).

Tiếng Việt + tiếng Anh. Trình duyệt (React PWA) → HTTPS → FastAPI.
Giai đoạn phát triển chạy trên laptop; deploy VPS làm sau. Đây là project demo,
dữ liệu gửi tới API Gemini không phải vấn đề.

## 2. Stack
- Backend: Python 3.11, FastAPI, SQLite (WAL)
- Embedding: BAAI/bge-m3 (dense, 1024 chiều, chuẩn hóa L2), chạy CPU
- Vector index: FAISS IndexFlatIP + IndexIDMap, mỗi user một file (id = chunks.id)
- Đồ thị: NetworkX (dựng từ bảng links khi cần vẽ/phân tích)
- PDF: PyMuPDF, chỉ trích text, không OCR
- LLM: Gemini qua lớp LLMClient (đổi nhà cung cấp chỉ sửa cấu hình)
- Auth: JWT, mật khẩu argon2, tài khoản tạo bằng script, không đăng ký công khai
- Frontend: React + Vite + TypeScript, CodeMirror 6, force-graph, PWA tối thiểu

## 3. Dữ liệu (xem backend/app/core/db.py)
users, notes (status: pending/indexing/ready/failed), chunks (id = ID vector FAISS),
links (type: wiki | semantic; score), messages.

## 4. Pipeline lập chỉ mục (khi lưu/sửa/xóa ghi chú, chạy nền)
1. Xóa chunk, vector, cạnh cũ của ghi chú.
2. Chunk lại (heading trước, sau đó ~1500 ký tự, chồng lấn 200), embed, thêm vào FAISS.
3. Mỗi chunk mới: top-k láng giềng (k=5) trong chỉ mục cùng user, loại chunk cùng ghi chú;
   tạo cạnh semantic nếu cosine ≥ τ. τ CHƯA CỐ ĐỊNH: thử 0.55–0.75 trên dữ liệu thật.
4. Phân tích [[tiêu đề]] tạo cạnh wiki (dst_note NULL nếu chưa có ghi chú).
Chỉ cập nhật cạnh của phần thay đổi, không tính lại toàn bộ cặp.

## 5. Truy hồi lai có đồ thị
1. Embed câu hỏi, top-8 chunk theo vector → danh sách A.
2. Mở rộng 1-hop từ A qua links: semantic → chunk láng giềng; wiki → 2 chunk của ghi chú đích
   giống câu hỏi nhất. Xếp hạng theo (điểm chunk gốc × điểm cạnh) → danh sách B.
3. Gộp A và B bằng RRF (k=60), lấy top-5 làm ngữ cảnh.
4. Prompt: chỉ trả lời từ ngữ cảnh, đánh dấu nguồn [1] [2], trả lời theo ngôn ngữ câu hỏi,
   nói rõ nếu không đủ thông tin.
5. API trả về câu trả lời + nguồn (ghi chú, chunk, trực tiếp hay qua liên kết).
Baseline so sánh: vector thuần (chỉ danh sách A).

## 6. API (tiền tố /api; Swagger tại /docs)
Auth: GET /config (allow_registration, invite_required) | POST /auth/register {username, password≥8, invite_code?}
  → JWT | POST /auth/login (form username+password → JWT Bearer) | GET /me
  Đăng ký: tên 3–32 ký tự [A-Za-z0-9_.-], không phân biệt hoa/thường; tắt được bằng ALLOW_REGISTRATION=false,
  yêu cầu mã mời bằng INVITE_CODE. Giới hạn tốc độ trong bộ nhớ: đăng nhập sai 10 lần/5 phút (theo IP+tên) → 429;
  đăng ký 5 lần/giờ/IP. (Chạy nhiều tiến trình/máy thì cần thay bằng Redis.)
Ghi chú: GET /notes[?full=true] | POST /notes | POST /notes/upload (.md/.txt/.pdf) | GET/PUT/DELETE /notes/{id}
  PDF upload: lưu file gốc tại uploads/<user_id>/<uuid>.pdf (đường dẫn tương đối trong DB, chống path traversal),
  GET /notes/{id}/file trả PDF (chỉ chủ sở hữu); xóa ghi chú xóa luôn file. Ghi chú có has_file, file_name.
  PUT nhận {content, base_version, title?} → {result: ok|merged|conflict, note}
Liên kết: GET /notes/{id}/related | GET /graph?min_score= (nút: id, title, source, has_file, degree)
Hỏi đáp: GET /search?q= | POST /chat {question, use_graph?} (mặc định vector thuần)
Đồng bộ: GET /sync/changes[?since=] | GET /events (SSE)
Header X-Device-Id (tùy chọn) để thiết bị nhận ra sự kiện do chính nó gây ra.
Mọi truy vấn lọc theo user_id lấy từ token; file PDF upload lưu theo user, tên do hệ thống đặt.

## 7. Giao diện (frontend/, React + Vite + TypeScript)
Bố cục kiểu Obsidian desktop, co lại thành ngăn kéo trên điện thoại:
- Đăng nhập / Đăng ký (có mã mời nếu máy chủ bật).
- Ribbon (thanh công cụ dọc): bật/tắt sidebar, ghi chú mới, mở nhanh, Graph, tải lên, hỏi đáp, bảng lệnh, đồng bộ, cài đặt.
- Sidebar trái: Tệp (sắp xếp, lọc theo thẻ), Tìm kiếm (từ khóa trên máy + tìm ngữ nghĩa qua API), Thẻ.
- Sidebar phải: Liên kết (backlink, liên kết đi, [[chưa tạo]], ghi chú liên quan tự động kèm điểm), Dàn ý, Hỏi đáp (nguồn bấm được).
- Tab: ghi chú, PDF gốc, Graph view. Editor: soạn / xem / chia đôi, thanh định dạng, tự hoàn thành [[, #thẻ, callout, bảng,
  việc cần làm; đổi tên ghi chú tự cập nhật [[liên kết]] ở ghi chú khác. Thanh trạng thái: đồng bộ trực tiếp/ngoại tuyến, số thay đổi chờ,
  trạng thái lập chỉ mục, phiên bản, xung đột, số từ.
- Graph view: chỉ hiện ghi chú có liên kết (có công tắc “ghi chú mồ côi”), ngưỡng cosine, chế độ “chỉ lân cận” theo độ sâu;
  bấm một nút → nút và hàng xóm sáng, phần còn lại mờ; bấm đúp hoặc “Mở ghi chú” → mở ghi chú; ghi chú từ PDF có nút “Mở PDF”.
- Phím tắt: Ctrl+N mới, Ctrl+O mở nhanh, Ctrl+P bảng lệnh, Ctrl+G graph, Ctrl+E soạn/xem, Ctrl+, cài đặt.
- Offline-first: SyncEngine ghi vào IndexedDB ngay, đẩy lên máy chủ có debounce kèm base_version, nhận sự kiện qua SSE (mục 12).
  Service worker chỉ lưu vỏ ứng dụng, không chặn /api.
Cấu trúc: src/lib (merge, engine, api, live, idb, text, markdown, graphModel: thuần TS, có test), src/components, src/App.tsx.
Markdown hiển thị bằng AST tự viết, KHÔNG dùng innerHTML (không XSS từ nội dung ghi chú).

## 8. Đánh giá (phần được chấm)
- Truy hồi: 40–60 câu hỏi trên ghi chú thật (vi + en), có nhóm câu cần ghép nhiều ghi chú.
  Đo Recall@k, MRR: vector thuần vs truy hồi lai.
- Chất lượng trả lời: đúng/đủ/bám nguồn trên tập con.
- Liên kết ngữ nghĩa: lấy mẫu ~50 cặp cạnh, tự gán nhãn, precision theo từng τ.

## 9. Ngoài phạm vi
Không Electron, OCR/PDF scan, đồng bộ Drive/Dropbox, mã hóa dữ liệu, xác minh email/quên mật khẩu,
nhiều người dùng đại trà (đăng ký có sẵn nhưng chỉ ở mức demo: giới hạn tốc độ trong bộ nhớ, mã mời tùy chọn). Hạn chế: ghi chú và đoạn trích gửi tới API LLM (không local-first).

## 10. Lộ trình đến 15/12
- 9–15/11: schema, chunking, embedding, FAISS, import md/PDF, test
- 16–22/11: liên kết ngữ nghĩa + wiki-link, truy hồi lai, /chat
- 23–29/11: auth, API đầy đủ, bộ đánh giá, chỉnh τ
- 30/11–6/12: frontend (editor, graph, chat), responsive
- 7–13/12: deploy VPS, PWA, hoàn thiện báo cáo
Viết báo cáo song song. Nếu trễ: cắt PWA và deploy trước, KHÔNG cắt phần đánh giá.

## 12. Đồng bộ nhiều thiết bị (laptop + điện thoại)
Máy chủ là nguồn sự thật. Mỗi ghi chú có `version` tăng dần; mọi phiên bản lưu trong `note_versions`.
- Đồng bộ trực tiếp: mỗi thay đổi ghi một dòng vào `events`; GET /events (Server-Sent Events) đẩy sự kiện tới
  các thiết bị khác, không cần tải lại. Client dùng fetch + header Authorization (EventSource không gửi
  được header), tự nối lại kèm `since` = id sự kiện cuối. Sau khi mất mạng, GET /sync/changes?since= để bắt kịp.
- Đồng bộ ba chiều: thiết bị gửi bản sửa kèm `base_version` (phiên bản nó đồng bộ lần cuối).
  base == hiện tại → áp dụng. base < hiện tại → gộp ba chiều (base, máy chủ, thiết bị) theo dòng:
  sửa chỗ khác nhau → gộp tự động; cùng chèn thêm ở một vị trí → giữ cả hai; cùng sửa/xóa một đoạn khác
  nhau → xung đột: GIỮ CẢ HAI trong khối `<<<<<<<`/`=======`/`>>>>>>>`, đặt has_conflict, không mất dữ liệu.
- Tạo ngoại tuyến: client sinh `client_id` (uuid); gửi lại nhiều lần không tạo trùng. Trùng tiêu đề → thêm hậu tố " (2)".
- Xóa trên một thiết bị, sửa trên thiết bị khác: bản sửa trả 404, client tạo lại ghi chú từ nội dung của nó.
- Giới hạn đã biết: gộp theo dòng nên hai thiết bị sửa hai câu khác nhau trong CÙNG một dòng dài sẽ xung đột;
  chưa có dọn dẹp lịch sử phiên bản; frontend phải lưu hàng đợi ngoại tuyến (IndexedDB) và base_version.

## 11. Tiến độ
- [x] Gói 1: khung repo, schema SQLite, chunking + wiki-link, Embedder, GeminiClient, /health
- [x] Gói 2 (đã chạy thật trên máy: 28 test pass, smoke BGE-m3 + Gemini OK, import 21 file .md/.pdf OK): FaissStore, pdf.py, indexer.py, scripts create_user / import_folder / smoke_models
- [x] Gói 3 (test bằng embedder/LLM giả, 35 test pass ở phía mình; CHƯA chạy thật): retrieval.py (vector + 1-hop + RRF), rag.py, scripts ask.py / sample_links.py
- [x] Đã chạy thật scripts/ask.py --compare: trên bộ ghi chú hiện có (21 file, cùng một chủ đề), truy hồi lai trả đúng cùng 5 chunk với vector thuần, chỉ đổi thứ tự; đồ thị chưa kéo thêm chunk mới nào
- [x] Gói 4 (test bằng giả lập, 41 test pass ở phía mình; chưa chạy thật): evaluation.py + scripts/run_eval.py (R@3, R@5, MRR, all@5 ở mức ghi chú; vector vs hybrid quét graph_weight), eval/questions.example.jsonl
- [x] Gói 5: eval/questions.jsonl (BẢN NHÁP 39 câu: 20 direct + 19 multi, vi + en, do AI soạn từ nội dung 21 file; gold_notes hỗ trợ nguồn thay thế vì 2 PDF trùng nội dung với ghi chú .md) và eval/out_of_scope.txt (6 câu ngoài phạm vi để chấm tay khả năng từ chối)
- [x] KẾT QUẢ ĐO ĐẦU TIÊN (run_eval, 39 câu, bộ nháp, context_k=10, chạy thật): vector thuần direct R@5=1.00, multi R@5=0.92, multi all@5=0.84, MRR=0.97. Truy hồi lai RRF KÉM HƠN ở mọi chỉ số: MRR 0.73/0.65/0.59 (w=0.25/0.5/1.0), multi all@5 0.79/0.79/0.74. Chưa có bằng chứng đồ thị cải thiện truy hồi; cần báo cáo trung thực.
- [x] Gói 6 (chưa chạy thật): graph_mode="supplement" (giữ thứ tự vector, chỉ dành ≤ context_k-1 chỗ cuối cho ứng viên đồ thị), min_edge_score (lọc cạnh yếu lúc truy vấn), run_eval --part dev|test, --context-k, --diff
- [x] KẾT QUẢ TẬP DEV (19 câu: 10 direct + 9 multi; context_k=5; chạy thật). vector: multi R@5=0.74, all@5=0.44, MRR=1.00; direct tất cả 1.00. rrf (w=0.25/0.5/1): MRR 0.67/0.58/0.59, direct R@5 giảm còn 0.90, multi all@5=0.67. supp s=1: multi all@5=0.56. supp s=2: multi R@5=0.85, all@5=0.67, direct và MRR giữ 1.00 (all all@5 0.84 vs vector 0.74, tức +2/19 câu). supp s=2 e>=0.75 quay về mức vector (all@5 multi 0.44): các cạnh có ích nằm ở khoảng cosine < 0.75. 11/19 câu RRF w=0.25 tệ hơn vector, chủ yếu do chunk của vài ghi chú "hub" (13_System_Architecture, 16_Evaluation_Testing, 06, 04) chen lên đầu danh sách.
- [x] CẤU HÌNH CHỌN TRƯỚC KHI XEM TẬP TEST: supp s=2 (không lọc cạnh). Chạy --part test đúng MỘT lần để báo cáo, không chỉnh lại theo kết quả test. Lưu ý n nhỏ (9 câu multi ở dev): chênh 2 câu chưa đủ để kết luận chắc.
- [x] Gói 7: graph_stats.py + scripts/link_degree.py (bậc cạnh từng ghi chú, kiểm tra giả thuyết hub)
- [x] KẾT QUẢ TẬP TEST (20 câu: 10 direct + 10 multi; chạy thật, một lần): cấu hình đã chốt trước `supp s=2` KHÔNG tốt hơn vector: multi all@5 0.50 vs 0.60, multi R@5 0.70 vs 0.80, all all@5 0.75 vs 0.80; MRR giữ 0.93. RRF vẫn hại MRR (0.77/0.71/0.57 vs 0.93). `supp s=1` nhỉnh hơn vector ở cả dev lẫn test (multi all@5 +1 câu mỗi tập; direct và MRR không đổi) nhưng chỉ là quan sát thăm dò vì không được chốt trước. Gộp hai tập (số câu lấy đủ ghi chú/39): vector 30, supp s=1 32, supp s=2 31 — chênh 1–2 câu, chưa có bằng chứng đồ thị cải thiện truy hồi trên bộ dữ liệu nhỏ, đồng chủ đề này. Kết luận trung thực: (1) gộp RRF cân bằng làm hại thứ tự; (2) supplement an toàn nhưng lợi ích chưa chứng minh được; (3) cần bộ dữ liệu lớn và đa chủ đề hơn + nhiều câu multi hơn.
- [x] Gói 8: run_eval --compare (chênh lệch so với vector + khoảng tin cậy 95% bootstrap ghép cặp, đếm số câu tốt hơn/tệ hơn)
- [ ] Chạy run_eval --part all --compare để có số liệu cuối trên 39 câu; chạy sample_links để chọn τ; chấm tay chất lượng câu trả lời
- [x] Auth + API + đồng bộ + đăng ký + lưu PDF gốc. Schema v3 (file_path, file_name), migration idempotent từ v1/v2. Sandbox: 85 test backend pass, 1 skip (API test cần fastapi, chạy trên máy bạn).
- [x] Frontend (gói 10): thư viện thuần TS có 60 test pass (merge, engine offline/đồng bộ, api, text, markdown, graphModel); toàn bộ component biên dịch bằng esbuild và render thử bằng react-dom/server. CHƯA chạy trong trình duyệt thật: cần `npm install && npm run dev` và xem bằng mắt.
- [ ] Việc còn lại: kiểm thử tay trên trình duyệt + điện thoại, chọn τ (sample_links), chấm tay chất lượng câu trả lời, thêm ghi chú đa chủ đề, deploy VPS (để sau).

Ghi chú thiết kế:
- Cạnh semantic lưu một chiều (chunk mới → láng giềng), đọc hai chiều bằng src OR dst. Chưa tính lại cạnh của ghi chú cũ khi có ghi chú mới.
- Lập chỉ mục chạy với connection riêng cho mỗi tác vụ nền (sẽ làm khi viết API); hiện script dùng một connection.
- Nếu SQLite và FAISS lệch nhau: viết lệnh reindex toàn bộ (POST /reindex).
- RRF k=60 rất phẳng ở đầu danh sách (chênh hạng 1–2 ≈ 0.0003) trong khi phần cộng từ danh sách đồ thị ≈ 0.004 ở w=0.25, nên đồ thị đảo thứ tự vector ở đầu danh sách (giả thuyết giải thích MRR giảm; chế độ supplement dùng để kiểm tra). RRF cân bằng (graph_weight=1.0) cho phép chunk liền kề hạt giống vượt cả hạt giống nhờ cạnh đồ thị. Đây là tham số cần quét khi đánh giá (thử 0, 0.25, 0.5, 1.0); graph_weight=0 trả đúng thứ tự vector thuần.
- Bộ ghi chú hiện có: 19 ghi chú ~1 KB + 2 PDF tóm tắt, cùng một chủ đề, 82 chunk. Nhỏ và đồng nhất, nên kết quả chỉ mang tính thử nghiệm; nên bổ sung ghi chú thật thuộc chủ đề khác trước khi chốt số liệu cho báo cáo.
- Cảnh báo về dữ liệu đánh giá: nếu mọi ghi chú cùng một chủ đề thì hàng xóm đồ thị trùng với hàng xóm vector và đồ thị không có chỗ để chứng minh giá trị. Bộ đánh giá cần câu hỏi "multi" mà ghi chú đích ít trùng từ vựng/ngữ nghĩa trực tiếp với câu hỏi, và nên có thêm ghi chú thuộc chủ đề khác.
- BGE-m3: hai câu không liên quan vẫn có cosine khoảng 0.37 (đo thực tế), nên τ không được đặt thấp.
