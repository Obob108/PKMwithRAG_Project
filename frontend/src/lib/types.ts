// Kiểu dữ liệu dùng chung. Chỉ dùng cú pháp TypeScript "xóa được" (không enum/namespace).

export interface RemoteNote {
  id: number;
  title: string;
  content: string;
  version: number;
  has_conflict: boolean;
  status: string; // pending | indexing | ready | failed
  updated_at: string;
  source: string; // "md" | "pdf"
  has_file: boolean; // có file PDF gốc trên máy chủ
  file_name: string | null;
}

export interface RemoteEvent {
  id: number;
  type: "created" | "updated" | "deleted";
  note_id: number;
  version: number;
  device_id: string | null;
}

// Bản ghi cục bộ (lưu trong IndexedDB). `key` ổn định suốt đời bản ghi, kể cả khi ghi chú tạo ngoại tuyến
// sau đó nhận id từ máy chủ.
export interface LocalNote {
  key: string; // "srv:<id>" hoặc "local:<uuid>"
  id: number | null; // null = chưa có trên máy chủ
  client_id: string | null; // uuid để tạo ghi chú idempotent
  title: string;
  content: string;
  base_title: string; // tiêu đề tại phiên bản đồng bộ gần nhất
  base_content: string; // nội dung tại phiên bản đồng bộ gần nhất
  base_version: number; // 0 = chưa đồng bộ lần nào
  dirty: boolean; // có thay đổi chưa gửi
  deleted: boolean; // đã xóa cục bộ, chờ xóa trên máy chủ
  has_conflict: boolean;
  status: string;
  updated_ms: number;
  source: string;
  has_file: boolean;
  file_name: string | null;
}

export type UpdateResult =
  | { kind: "ok"; result: "ok" | "merged" | "conflict"; note: RemoteNote }
  | { kind: "notfound" }
  | { kind: "title_taken" }
  | { kind: "bad_version" };

export interface Api {
  listNotes(): Promise<RemoteNote[]>; // kèm nội dung
  cursor(): Promise<number>;
  changes(since: number): Promise<{ cursor: number; events: RemoteEvent[] }>;
  getNote(id: number): Promise<RemoteNote | null>;
  createNote(input: { title: string; content: string; client_id: string }): Promise<RemoteNote>;
  updateNote(id: number, input: { content: string; base_version: number; title?: string }): Promise<UpdateResult>;
  deleteNote(id: number): Promise<void>; // 404 coi như đã xóa
}

export interface Store {
  all(): Promise<LocalNote[]>;
  put(note: LocalNote): Promise<void>;
  remove(key: string): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export class NetworkError extends Error {}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}
