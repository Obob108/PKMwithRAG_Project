// Bộ ghi chú mẫu cho chế độ demo (khách chưa đăng nhập). Chủ đề: sinh viên IT ghi chú học Data Engineering,
// học máy và phương pháp học. Các [[wiki-link]] là liên kết người dùng tự viết; DEMO_LINKS là gợi ý liên kết
// ngữ nghĩa được TÍNH SẴN (minh họa kết quả của BGE-m3 + cosine trên bản thật), cố ý nối những ghi chú
// không có [[...]] với nhau để khách thấy giá trị của "liên kết tự động".

export interface DemoFolder {
  id: number;
  name: string;
}

export interface DemoNote {
  id: number;
  title: string;
  folder_id: number | null;
  content: string;
}

/** Gợi ý liên kết ngữ nghĩa giữa hai ghi chú: điểm cosine minh họa + heading của cặp đoạn giống nhau nhất. */
export interface DemoLink {
  a: string; // tiêu đề ghi chú
  b: string;
  score: number;
  ha: string; // heading đoạn trong a ("" = phần mở đầu trước heading đầu tiên)
  hb: string;
}

/** Câu hỏi mẫu cho trợ lý hỏi đáp: khớp theo từ khóa, câu trả lời viết sẵn từ chính các ghi chú mẫu. */
export interface DemoQa {
  question: string;
  keywords: string[]; // đã bỏ dấu, chữ thường
  answer: string;
  sources: { title: string; heading: string; via: "vector" | "graph" | "both" }[];
}

export const DEMO_FOLDERS: DemoFolder[] = [
  { id: 1, name: "Data Engineering" },
  { id: 2, name: "Học máy & AI" },
  { id: 3, name: "Kỹ năng học tập" },
];

export const START_TITLE = "Bắt đầu ở đây";

export const DEMO_NOTES: DemoNote[] = [
  {
    id: 1,
    title: START_TITLE,
    folder_id: null,
    content: `# Chào mừng bạn đến với bản demo

Đây là một kho ghi chú mẫu của một sinh viên IT đang học Data Engineering và AI. Bạn có thể đọc, sửa, tạo ghi chú mới thoải mái: mọi thay đổi chỉ nằm trên trình duyệt này và sẽ mất khi tải lại trang.

> [!tip] Ứng dụng này khác gì một trình soạn ghi chú thông thường?
> Bạn chỉ việc viết. Hệ thống tự đọc hiểu nội dung, **tự gợi ý những ghi chú có liên quan** dù bạn chưa từng liên kết chúng, và **trả lời câu hỏi dựa trên chính ghi chú của bạn**, kèm nguồn để kiểm chứng.

## Thử 4 việc trong 2 phút

- [ ] Bấm biểu tượng **Graph** ở thanh công cụ: mỗi chấm là một ghi chú, màu theo thư mục. Nét liền là liên kết bạn tự viết, nét đứt là liên kết AI gợi ý.
- [ ] Mở ghi chú [[dbt]], bật **thanh bên phải** (nút ▤), tab **Liên kết**: hệ thống gợi ý [[ETL và ELT]] và [[Apache Airflow]] dù ghi chú dbt không hề nhắc tới chúng. Rê chuột vào % để xem vì sao.
- [ ] Mở tab **Hỏi đáp** và hỏi: *ETL và ELT khác nhau thế nào?* hoặc *RAG hoạt động như thế nào?*
- [ ] Tạo một ghi chú mới, gõ \`[[\` để liên kết tới ghi chú khác, gõ \`#\` để gắn thẻ.

## Ghi chú mẫu trong kho

| Thư mục | Ghi chú |
|---|---|
| Data Engineering | [[ETL và ELT]], [[Data Warehouse]], [[Apache Airflow]], [[dbt]], [[SQL Window Functions]] |
| Học máy & AI | [[Embedding và Cosine Similarity]], [[RAG - Retrieval-Augmented Generation]], [[Vector Database]] |
| Kỹ năng học tập | [[Phương pháp Zettelkasten]], [[Ôn thi Cơ sở dữ liệu]] |

Muốn lưu tri thức của chính bạn, đồng bộ giữa laptop và điện thoại, dùng được cả khi mất mạng? Bấm **Đăng ký miễn phí** ở thanh trên cùng.

#huong-dan`,
  },
  {
    id: 2,
    title: "ETL và ELT",
    folder_id: 1,
    content: `# ETL và ELT

Hai cách đưa dữ liệu từ hệ thống nguồn vào kho phân tích. Khác nhau ở **thứ tự** của bước biến đổi (Transform).

## ETL: Extract → Transform → Load

- Lấy dữ liệu ra, biến đổi trên một máy chủ trung gian, rồi mới nạp vào kho.
- Phù hợp khi kho dữ liệu đắt hoặc yếu, cần làm sạch trước khi nạp.
- Nhược điểm: muốn đổi logic biến đổi thì phải chạy lại cả pipeline.

## ELT: Extract → Load → Transform

- Nạp dữ liệu thô vào kho trước, biến đổi **ngay bên trong kho** bằng SQL.
- Phổ biến với kho dữ liệu đám mây (BigQuery, Snowflake) vì sức tính toán rẻ và co giãn được.
- Dữ liệu thô vẫn còn đó, nên có thể biến đổi lại bất cứ lúc nào.

## So sánh nhanh

| Tiêu chí | ETL | ELT |
|---|---|---|
| Biến đổi ở đâu | Máy chủ trung gian | Trong kho dữ liệu |
| Giữ dữ liệu thô | Thường không | Có |
| Công cụ hay gặp | Informatica, SSIS | SQL trong kho |

Kho đích thường được thiết kế theo [[Data Warehouse]].

#data-engineering #pipeline`,
  },
  {
    id: 3,
    title: "Data Warehouse",
    folder_id: 1,
    content: `# Data Warehouse

Kho dữ liệu tập trung, tối ưu cho **truy vấn phân tích** (đọc nhiều, tổng hợp lớn) chứ không phải giao dịch hằng ngày.

## Mô hình hình sao (star schema)

- **Bảng fact**: lưu sự kiện đo lường được, ví dụ mỗi dòng là một đơn hàng với số lượng, doanh thu.
- **Bảng dimension**: lưu ngữ cảnh mô tả, ví dụ khách hàng, sản phẩm, thời gian.
- Fact nằm ở giữa, nối tới các dimension bằng khóa ngoại.

## OLTP khác OLAP

- OLTP (cơ sở dữ liệu ứng dụng): nhiều giao dịch nhỏ, chuẩn hóa cao.
- OLAP (kho dữ liệu): ít truy vấn nhưng quét rất nhiều dòng, chấp nhận phi chuẩn hóa để đọc nhanh.

Truy vấn phân tích trên kho hay dùng [[SQL Window Functions]].

#data-engineering #database`,
  },
  {
    id: 4,
    title: "Apache Airflow",
    folder_id: 1,
    content: `# Apache Airflow

Công cụ **điều phối** (orchestration) pipeline dữ liệu: định nghĩa các bước, thứ tự phụ thuộc và lịch chạy.

## DAG

- Pipeline được viết bằng Python dưới dạng DAG: đồ thị có hướng, không có chu trình.
- Mỗi nút là một task; mũi tên là quan hệ "chạy sau".
- Scheduler đọc DAG và chạy task đúng lịch, tự thử lại khi lỗi.

## Airflow không làm gì

Airflow chỉ ra lệnh cho các công cụ khác chạy và theo dõi kết quả. Bản thân nó **không phải công cụ biến đổi dữ liệu**; phần biến đổi thường giao cho SQL hoặc công cụ chuyên dụng.

Một pipeline điển hình theo kiểu [[ETL và ELT]]: task lấy dữ liệu → task nạp vào kho → task biến đổi.

#data-engineering #orchestration`,
  },
  {
    id: 5,
    title: "dbt",
    folder_id: 1,
    content: `# dbt (data build tool)

Công cụ viết **phần biến đổi dữ liệu bằng SQL** ngay trong kho, có quản lý phiên bản và kiểm thử như code phần mềm.

## Ý tưởng chính

- Mỗi model là một file \`.sql\` chứa câu SELECT; dbt tự sinh bảng hoặc view.
- Dùng \`ref()\` để model này tham chiếu model khác; dbt tự tính thứ tự chạy.
- Viết test cho dữ liệu: không null, không trùng, giá trị hợp lệ.

## Vì sao sinh viên data nên học

- Biến SQL rời rạc thành dự án có cấu trúc, review được, chạy lại được.
- Sinh tài liệu và sơ đồ phụ thuộc giữa các bảng.

Ghi chú: dbt chỉ lo phần T. Lịch chạy hằng ngày cần một công cụ điều phối đứng ngoài.

#data-engineering #sql`,
  },
  {
    id: 6,
    title: "SQL Window Functions",
    folder_id: 1,
    content: `# SQL Window Functions

Hàm tính trên một "cửa sổ" các dòng liên quan **mà không gộp mất dòng** như GROUP BY.

## Cú pháp

\`\`\`sql
SELECT customer_id, order_date, amount,
       SUM(amount) OVER (PARTITION BY customer_id ORDER BY order_date) AS luy_ke
FROM orders;
\`\`\`

## Hàm hay dùng

- \`ROW_NUMBER()\`: đánh số thứ tự trong mỗi nhóm, dùng để lấy bản ghi mới nhất.
- \`RANK()\` / \`DENSE_RANK()\`: xếp hạng, xử lý đồng hạng khác nhau.
- \`LAG()\` / \`LEAD()\`: lấy giá trị dòng trước/sau, ví dụ so doanh thu với tháng trước.

#sql #database`,
  },
  {
    id: 7,
    title: "Embedding và Cosine Similarity",
    folder_id: 2,
    content: `# Embedding và Cosine Similarity

**Embedding** biến một đoạn văn thành một vector số sao cho các đoạn có **ý nghĩa gần nhau** thì vector cũng gần nhau, kể cả khi không dùng chung từ nào.

## Đo độ giống nhau

Độ tương đồng cosine giữa hai vector:

$$\\cos(\\mathbf{a}, \\mathbf{b}) = \\frac{\\mathbf{a} \\cdot \\mathbf{b}}{\\lVert \\mathbf{a} \\rVert \\, \\lVert \\mathbf{b} \\rVert}$$

- Gần 1: cùng hướng, rất giống nhau về nghĩa.
- Gần 0: không liên quan.
- Nếu đã chuẩn hóa độ dài vector về 1 thì cosine chính là tích vô hướng.

## Mô hình đa ngôn ngữ

Mô hình như BGE-m3 đặt câu tiếng Việt và tiếng Anh cùng nghĩa vào gần nhau, nên ghi chú song ngữ vẫn tìm được nhau.

#machine-learning #nlp`,
  },
  {
    id: 8,
    title: "RAG - Retrieval-Augmented Generation",
    folder_id: 2,
    content: `# RAG - Retrieval-Augmented Generation

Kỹ thuật cho mô hình ngôn ngữ (LLM) **trả lời dựa trên tài liệu của bạn** thay vì chỉ dựa vào những gì nó đã học.

## Các bước

1. Chia tài liệu thành đoạn nhỏ (chunk) và tính embedding cho từng đoạn, xem [[Embedding và Cosine Similarity]].
2. Khi có câu hỏi: tính embedding của câu hỏi, tìm các đoạn gần nhất.
3. Đưa câu hỏi cùng các đoạn tìm được vào prompt, yêu cầu LLM chỉ trả lời từ đó và ghi nguồn.

## Vì sao cần

- LLM không biết nội dung ghi chú riêng của bạn.
- Có nguồn trích dẫn nên kiểm chứng được, giảm bịa đặt.
- Cập nhật tài liệu là xong, không cần huấn luyện lại mô hình.

#machine-learning #llm`,
  },
  {
    id: 9,
    title: "Vector Database",
    folder_id: 2,
    content: `# Vector Database

Nơi lưu và **tìm kiếm theo độ gần** giữa các vector, ví dụ tìm 5 đoạn văn giống câu hỏi nhất trong hàng triệu đoạn.

## Lựa chọn phổ biến

- **FAISS**: thư viện của Meta, chạy trong tiến trình, rất nhanh.
- **pgvector**: tiện ích mở rộng của PostgreSQL; vector nằm chung bảng với dữ liệu thường, ghi trong cùng một transaction.
- Dịch vụ chuyên dụng: Pinecone, Qdrant, Weaviate.

## Tìm chính xác hay xấp xỉ

- Tìm chính xác (vét cạn): đúng 100%, đủ nhanh khi có vài chục nghìn vector.
- Chỉ mục xấp xỉ (HNSW, IVF): nhanh hơn nhiều ở quy mô lớn, đổi lại có thể bỏ sót một ít kết quả.

#database #machine-learning`,
  },
  {
    id: 10,
    title: "Phương pháp Zettelkasten",
    folder_id: 3,
    content: `# Phương pháp Zettelkasten

Cách ghi chú của nhà xã hội học Niklas Luhmann: tri thức có giá trị nằm ở **mối liên kết** giữa các ý, không nằm ở từng ghi chú riêng lẻ.

## Nguyên tắc

- **Ghi chú nguyên tử**: mỗi ghi chú chỉ một ý, viết bằng lời của chính mình.
- **Liên kết có chủ đích**: khi viết ghi chú mới, tìm ghi chú cũ liên quan và nối chúng lại.
- Theo thời gian, mạng lưới ghi chú trở thành "người cộng sự" giúp nảy ra ý mới.

## Khó khăn khi làm thủ công

Kho càng lớn càng khó nhớ mình đã viết gì, nên nhiều liên kết đáng giá không bao giờ được tạo ra. Đây là chỗ máy có thể giúp: tự phát hiện ghi chú gần nghĩa để gợi ý.

#hoc-tap #pkm`,
  },
  {
    id: 11,
    title: "Ôn thi Cơ sở dữ liệu",
    folder_id: 3,
    content: `# Ôn thi Cơ sở dữ liệu

Danh sách ôn tập cuối kỳ.

## Cần ôn

- [x] Chuẩn hóa: 1NF, 2NF, 3NF, BCNF
- [x] Khóa chính, khóa ngoại, ràng buộc toàn vẹn
- [ ] JOIN các loại và khi nào dùng
- [ ] Hàm cửa sổ: xem [[SQL Window Functions]]
- [ ] Chỉ mục (index) và vì sao truy vấn chậm

## Mẹo làm bài

- Vẽ sơ đồ quan hệ trước khi viết truy vấn.
- Bài tổng hợp theo nhóm: nghĩ tới GROUP BY trước, cần giữ từng dòng thì nghĩ tới hàm cửa sổ.

#hoc-tap #database`,
  },
];

export const DEMO_LINKS: DemoLink[] = [
  { a: "dbt", b: "ETL và ELT", score: 0.81, ha: "dbt (data build tool)", hb: "ELT: Extract → Load → Transform" },
  { a: "Vector Database", b: "RAG - Retrieval-Augmented Generation", score: 0.79, ha: "Vector Database", hb: "Các bước" },
  { a: "Vector Database", b: "Embedding và Cosine Similarity", score: 0.77, ha: "Tìm chính xác hay xấp xỉ", hb: "Đo độ giống nhau" },
  { a: "dbt", b: "Apache Airflow", score: 0.74, ha: "Vì sao sinh viên data nên học", hb: "Airflow không làm gì" },
  { a: "dbt", b: "Data Warehouse", score: 0.72, ha: "Ý tưởng chính", hb: "Mô hình hình sao (star schema)" },
  { a: "Ôn thi Cơ sở dữ liệu", b: "Data Warehouse", score: 0.7, ha: "Cần ôn", hb: "OLTP khác OLAP" },
  { a: "Phương pháp Zettelkasten", b: "Embedding và Cosine Similarity", score: 0.68, ha: "Khó khăn khi làm thủ công", hb: "Embedding và Cosine Similarity" },
  { a: "Phương pháp Zettelkasten", b: "RAG - Retrieval-Augmented Generation", score: 0.67, ha: "Khó khăn khi làm thủ công", hb: "Vì sao cần" },
  { a: "SQL Window Functions", b: "Data Warehouse", score: 0.66, ha: "Hàm hay dùng", hb: "OLTP khác OLAP" },
];

export const DEMO_QA: DemoQa[] = [
  {
    question: "ETL và ELT khác nhau thế nào?",
    keywords: ["etl", "elt"],
    answer:
      "Khác nhau ở chỗ bước biến đổi (Transform) diễn ra ở đâu [1]:\n\n" +
      "- **ETL** biến đổi dữ liệu trên một máy chủ trung gian rồi mới nạp vào kho; muốn đổi logic thì phải chạy lại cả pipeline [1].\n" +
      "- **ELT** nạp dữ liệu thô vào kho trước rồi biến đổi ngay trong kho bằng SQL, nên dữ liệu thô vẫn còn và có thể biến đổi lại bất cứ lúc nào [2].\n\n" +
      "Ghi chú của bạn về dbt cho thấy dbt chính là công cụ làm phần T trong ELT, viết bằng SQL và có kiểm thử [3].",
    sources: [
      { title: "ETL và ELT", heading: "ETL: Extract → Transform → Load", via: "vector" },
      { title: "ETL và ELT", heading: "ELT: Extract → Load → Transform", via: "vector" },
      { title: "dbt", heading: "dbt (data build tool)", via: "graph" },
    ],
  },
  {
    question: "RAG hoạt động như thế nào?",
    keywords: ["rag", "retrieval", "truy hoi", "augmented"],
    answer:
      "Theo ghi chú của bạn, RAG gồm 3 bước [1]:\n\n" +
      "1. Chia tài liệu thành đoạn nhỏ và tính embedding cho từng đoạn.\n" +
      "2. Khi có câu hỏi, tính embedding câu hỏi rồi tìm các đoạn gần nhất, thường đo bằng độ tương đồng cosine [2].\n" +
      "3. Đưa các đoạn đó vào prompt và yêu cầu LLM chỉ trả lời từ đó, kèm nguồn [1].\n\n" +
      "Các vector thường được lưu trong một vector database như FAISS hoặc pgvector để tìm kiếm nhanh [3].",
    sources: [
      { title: "RAG - Retrieval-Augmented Generation", heading: "Các bước", via: "vector" },
      { title: "Embedding và Cosine Similarity", heading: "Đo độ giống nhau", via: "both" },
      { title: "Vector Database", heading: "Lựa chọn phổ biến", via: "graph" },
    ],
  },
  {
    question: "Khi nào dùng dbt, khi nào dùng Airflow?",
    keywords: ["dbt", "airflow", "dieu phoi", "orchestration"],
    answer:
      "Hai công cụ bổ sung cho nhau chứ không thay thế nhau:\n\n" +
      "- **dbt** dùng để viết phần biến đổi dữ liệu bằng SQL ngay trong kho, có test và quản lý phụ thuộc giữa các model [1].\n" +
      "- **Airflow** dùng để điều phối: định nghĩa thứ tự các bước và lịch chạy; bản thân nó không biến đổi dữ liệu [2].\n\n" +
      "Cách kết hợp thường gặp: Airflow lên lịch chạy hằng ngày, một task trong DAG gọi dbt để biến đổi dữ liệu [2][3].",
    sources: [
      { title: "dbt", heading: "Ý tưởng chính", via: "vector" },
      { title: "Apache Airflow", heading: "Airflow không làm gì", via: "both" },
      { title: "Apache Airflow", heading: "DAG", via: "vector" },
    ],
  },
  {
    question: "Zettelkasten là gì?",
    keywords: ["zettelkasten", "luhmann", "nguyen tu", "phuong phap ghi chu"],
    answer:
      "Zettelkasten là phương pháp ghi chú của Niklas Luhmann, cho rằng giá trị nằm ở mối liên kết giữa các ý [1]. " +
      "Hai nguyên tắc chính: mỗi ghi chú chỉ một ý viết bằng lời của mình, và chủ động nối ghi chú mới với ghi chú cũ [1].\n\n" +
      "Ghi chú của bạn cũng nêu khó khăn: kho càng lớn càng khó nhớ để tạo liên kết, nên máy có thể giúp bằng cách tự gợi ý ghi chú gần nghĩa [2].",
    sources: [
      { title: "Phương pháp Zettelkasten", heading: "Nguyên tắc", via: "vector" },
      { title: "Phương pháp Zettelkasten", heading: "Khó khăn khi làm thủ công", via: "vector" },
    ],
  },
  {
    question: "Ôn thi cơ sở dữ liệu còn thiếu phần nào?",
    keywords: ["on thi", "cuoi ky", "con thieu", "chua on"],
    answer:
      "Trong danh sách ôn tập, bạn đã xong chuẩn hóa và khóa/ràng buộc toàn vẹn; còn 3 mục chưa ôn [1]:\n\n" +
      "- Các loại JOIN và khi nào dùng.\n" +
      "- Hàm cửa sổ như ROW_NUMBER, RANK, LAG/LEAD [2].\n" +
      "- Chỉ mục (index) và vì sao truy vấn chậm.",
    sources: [
      { title: "Ôn thi Cơ sở dữ liệu", heading: "Cần ôn", via: "vector" },
      { title: "SQL Window Functions", heading: "Hàm hay dùng", via: "graph" },
    ],
  },
];
