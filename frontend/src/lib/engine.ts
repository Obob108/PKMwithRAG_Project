// Bộ máy đồng bộ ngoại tuyến-trước (offline-first).
//  - Mọi chỉnh sửa ghi vào bộ nhớ + IndexedDB ngay, rồi đẩy lên máy chủ (debounce).
//  - Đẩy kèm base_version; máy chủ gộp ba chiều nếu có người sửa trước.
//  - Trong lúc chờ phản hồi, người dùng có thể gõ tiếp: khi phản hồi về, bản gõ thêm được gộp lại
//    (base = nội dung đã gửi, ours = bản máy chủ trả về, theirs = bản đang gõ).
//  - Sự kiện từ thiết bị khác: ghi chú sạch thì tải lại; ghi chú đang sửa dở thì đẩy lên để máy chủ gộp.
import { conflictBlock, hasConflictMarkers, mergeText } from "./merge.ts";
import { ApiError, NetworkError } from "./types.ts";
import type { Api, LocalNote, RemoteEvent, RemoteNote, Store } from "./types.ts";

export interface EngineOptions {
  debounceMs?: number;
  retry?: boolean;
  now?: () => number;
  uuid?: () => string;
  deviceId?: string;
}

const MAX_LOOP = 10;

export class SyncEngine {
  api: Api;
  store: Store;
  deviceId: string;
  cursor: number | null = null;
  onUnauthorized: (() => void) | null = null;
  lastError: string | null = null;

  notes = new Map<string, LocalNote>();
  snapshot: LocalNote[] = [];
  listeners = new Set<() => void>();

  debounceMs: number;
  retry: boolean;
  now: () => number;
  uuid: () => string;

  timers = new Map<string, ReturnType<typeof setTimeout>>();
  inflight = new Set<string>();
  again = new Set<string>();
  running = new Set<Promise<void>>();
  writes: Promise<void> = Promise.resolve();
  retryTimer: ReturnType<typeof setTimeout> | null = null;
  retryDelay = 3000;

  constructor(api: Api, store: Store, opts: EngineOptions = {}) {
    this.api = api;
    this.store = store;
    this.debounceMs = opts.debounceMs ?? 800;
    this.retry = opts.retry ?? true;
    this.now = opts.now ?? (() => Date.now());
    this.uuid = opts.uuid ?? (() => Math.random().toString(36).slice(2) + Date.now().toString(36));
    this.deviceId = opts.deviceId ?? this.uuid();
  }

  // ---------------------------------------------------------------- trạng thái cho giao diện
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = (): LocalNote[] => this.snapshot;

  pendingCount(): number {
    let n = 0;
    for (const note of this.notes.values()) if (note.dirty || note.deleted) n++;
    return n;
  }

  keyById(id: number): string | null {
    return this.byId(id)?.key ?? null;
  }

  private byId(id: number): LocalNote | undefined {
    for (const n of this.notes.values()) if (n.id === id) return n;
    return undefined;
  }

  private rebuild(): void {
    this.snapshot = [...this.notes.values()]
      .filter((n) => !n.deleted)
      .sort((a, b) => b.updated_ms - a.updated_ms || a.key.localeCompare(b.key));
    for (const fn of this.listeners) fn();
  }

  private set(n: LocalNote): void {
    this.notes.set(n.key, n);
    this.writes = this.writes.then(() => this.store.put(n)).catch((e) => console.error("IndexedDB", e));
    this.rebuild();
  }

  private dropLocal(key: string): void {
    this.notes.delete(key);
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
    this.writes = this.writes.then(() => this.store.remove(key)).catch((e) => console.error("IndexedDB", e));
    this.rebuild();
  }

  private async setCursor(c: number): Promise<void> {
    if (this.cursor !== null && c <= this.cursor) return;
    this.cursor = c;
    await this.store.setMeta("cursor", c);
  }

  async init(): Promise<void> {
    for (const n of await this.store.all()) this.notes.set(n.key, n);
    const c = await this.store.getMeta("cursor");
    this.cursor = typeof c === "number" ? c : null;
    this.rebuild();
  }

  /** Chờ mọi tác vụ đẩy lên và ghi IndexedDB đang chạy xong (dùng trong kiểm thử). */
  async settle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
    await this.writes;
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // ---------------------------------------------------------------- thao tác của người dùng
  create(title: string, content = ""): LocalNote {
    const n: LocalNote = {
      key: `local:${this.uuid()}`, id: null, client_id: this.uuid(),
      title, content, base_title: title, base_content: "", base_version: 0,
      dirty: true, deleted: false, has_conflict: hasConflictMarkers(content), status: "pending",
      updated_ms: this.now(), source: "md", has_file: false, file_name: null,
    };
    this.set(n);
    this.schedulePush(n.key);
    return n;
  }

  edit(key: string, patch: { title?: string; content?: string }): void {
    const n = this.notes.get(key);
    if (!n || n.deleted) return;
    const content = patch.content ?? n.content;
    this.set({
      ...n, title: patch.title ?? n.title, content, dirty: true,
      has_conflict: hasConflictMarkers(content), updated_ms: this.now(),
    });
    this.schedulePush(key);
  }

  remove(key: string): void {
    const n = this.notes.get(key);
    if (!n) return;
    if (n.id === null && !this.inflight.has(key)) {
      this.dropLocal(key); // chưa từng lên máy chủ
      return;
    }
    this.set({ ...n, deleted: true, dirty: true });
    this.schedulePush(key, 0);
  }

  // ---------------------------------------------------------------- đẩy lên máy chủ
  schedulePush(key: string, delay: number = this.debounceMs): void {
    const old = this.timers.get(key);
    if (old) clearTimeout(old);
    this.timers.delete(key);
    if (delay <= 0) {
      void this.pushNote(key);
      return;
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.pushNote(key);
    }, delay));
  }

  async syncAll(): Promise<void> {
    const keys = [...this.notes.values()].filter((n) => n.dirty || n.deleted).map((n) => n.key);
    await Promise.all(keys.map((k) => this.pushNote(k)));
  }

  pushNote(key: string): Promise<void> {
    if (this.inflight.has(key)) {
      this.again.add(key);
      return Promise.resolve();
    }
    this.inflight.add(key);
    const p = this.pushLoop(key).finally(() => {
      this.inflight.delete(key);
      this.running.delete(p);
    });
    this.running.add(p);
    return p;
  }

  private async pushLoop(key: string): Promise<void> {
    for (let i = 0; i < MAX_LOOP; i++) {
      this.again.delete(key);
      const progressed = await this.pushOnce(key);
      const n = this.notes.get(key);
      if (!progressed || !n) return;
      if (!(n.dirty || n.deleted) && !this.again.has(key)) return;
    }
  }

  /** true = đã gửi thành công một yêu cầu (có thể cần gửi tiếp); false = dừng (lỗi mạng/xác thực/không có gì). */
  private async pushOnce(key: string): Promise<boolean> {
    const n = this.notes.get(key);
    if (!n) return false;
    try {
      let ok: boolean;
      if (n.deleted) ok = await this.pushDelete(n);
      else if (!n.dirty) return false;
      else ok = n.id === null ? await this.pushCreate(n) : await this.pushUpdate(n);
      this.retryDelay = 3000;
      this.lastError = null;
      return ok;
    } catch (e) {
      return this.handleError(e);
    }
  }

  private handleError(e: unknown): boolean {
    if (e instanceof NetworkError) {
      this.lastError = "offline";
      this.scheduleRetry();
    } else if (e instanceof ApiError && e.status === 401) {
      this.onUnauthorized?.();
    } else {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error(e);
    }
    return false;
  }

  private scheduleRetry(): void {
    if (!this.retry || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncAll();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 60000);
  }

  private async pushDelete(n: LocalNote): Promise<boolean> {
    if (n.id !== null) await this.api.deleteNote(n.id);
    this.dropLocal(n.key);
    return false; // xong, không còn gì để gửi
  }

  private async pushCreate(n: LocalNote): Promise<boolean> {
    const sentContent = n.content;
    const sentTitle = n.title;
    const remote = await this.api.createNote({ title: sentTitle, content: sentContent, client_id: n.client_id ?? this.uuid() });
    this.adopt(n.key, remote, sentContent, sentTitle);
    return true;
  }

  private async pushUpdate(n: LocalNote): Promise<boolean> {
    const sentContent = n.content;
    const sentTitle = n.title;
    const id = n.id as number;
    const res = await this.api.updateNote(id, { content: sentContent, base_version: n.base_version, title: sentTitle });
    const cur = this.notes.get(n.key);
    if (!cur) return false;
    if (res.kind === "ok") {
      this.adopt(n.key, res.note, sentContent, sentTitle);
      return true;
    }
    if (res.kind === "notfound") {
      this.recreate(cur); // ai đó đã xóa: bản sửa của mình thắng, tạo lại
      return true;
    }
    if (res.kind === "title_taken") {
      const title = cur.title === sentTitle ? cur.base_title : cur.title;
      this.set({ ...cur, title, dirty: cur.content !== cur.base_content || title !== cur.base_title });
      return cur.content !== cur.base_content;
    }
    // bad_version: mốc đồng bộ của mình không còn hợp lệ; tải bản máy chủ và giữ cả hai
    const remote = await this.api.getNote(id);
    if (remote === null) {
      this.recreate(cur);
      return true;
    }
    const content = remote.content === cur.content ? cur.content : conflictBlock(remote.content, cur.content);
    this.set({
      ...cur, content, base_title: remote.title, base_content: remote.content, base_version: remote.version,
      dirty: true, has_conflict: hasConflictMarkers(content), status: remote.status,
    });
    return true;
  }

  private recreate(n: LocalNote): void {
    this.set({ ...n, id: null, client_id: this.uuid(), base_version: 0, base_content: "", base_title: n.title, dirty: true });
  }

  /** Nhận phản hồi của máy chủ; nếu người dùng đã gõ thêm trong lúc chờ thì gộp lại bản gõ thêm. */
  private adopt(key: string, remote: RemoteNote, sentContent: string, sentTitle: string): void {
    const cur = this.notes.get(key);
    if (!cur) return;
    const content = cur.content === sentContent ? remote.content : mergeText(sentContent, remote.content, cur.content).text;
    const title = cur.title === sentTitle ? remote.title : cur.title;
    this.set({
      ...cur, id: remote.id, title, content,
      base_title: remote.title, base_content: remote.content, base_version: remote.version,
      dirty: content !== remote.content || title !== remote.title || cur.deleted,
      has_conflict: hasConflictMarkers(content), status: remote.status,
      source: remote.source, has_file: remote.has_file, file_name: remote.file_name,
    });
  }

  // ---------------------------------------------------------------- nhận thay đổi từ máy chủ
  private serverMs(s: string): number {
    const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
    return Number.isNaN(t) ? this.now() : t;
  }

  private fromRemote(r: RemoteNote, key?: string): LocalNote {
    return {
      key: key ?? `srv:${r.id}`, id: r.id, client_id: null, title: r.title, content: r.content,
      base_title: r.title, base_content: r.content, base_version: r.version,
      dirty: false, deleted: false, has_conflict: r.has_conflict, status: r.status,
      updated_ms: this.serverMs(r.updated_at), source: r.source, has_file: r.has_file, file_name: r.file_name,
    };
  }

  private applyRemote(r: RemoteNote): void {
    const local = this.byId(r.id);
    if (!local) {
      this.set(this.fromRemote(r));
      return;
    }
    if (local.dirty || local.deleted) return; // sẽ được đẩy lên và gộp ở máy chủ
    if (r.version >= local.base_version) this.set(this.fromRemote(r, local.key));
  }

  private onRemoteDeleted(id: number): void {
    const n = this.byId(id);
    if (!n) return;
    if (n.deleted || !n.dirty) {
      this.dropLocal(n.key);
      return;
    }
    this.recreate(n); // đang sửa dở: giữ bản sửa, tạo lại thành ghi chú mới
    this.schedulePush(n.key, 0);
  }

  /** Lần đồng bộ đầu (hoặc khi mất con trỏ): lấy toàn bộ ghi chú và đối chiếu với bản cục bộ. */
  async bootstrap(): Promise<void> {
    const cursor = await this.api.cursor(); // lấy con trỏ TRƯỚC khi liệt kê để không sót sự kiện
    const remotes = await this.api.listNotes();
    const seen = new Set<number>();
    for (const r of remotes) {
      seen.add(r.id);
      this.applyRemote(r);
    }
    for (const n of [...this.notes.values()]) {
      if (n.id !== null && !seen.has(n.id)) this.onRemoteDeleted(n.id);
    }
    this.cursor = null;
    await this.setCursor(cursor);
    await this.syncAll();
  }

  /** Bắt kịp các sự kiện đã bỏ lỡ (khởi động, mất mạng rồi có lại). */
  async catchUp(): Promise<void> {
    if (this.cursor === null) {
      await this.bootstrap();
      return;
    }
    const { events } = await this.api.changes(this.cursor);
    for (const ev of events) await this.handleEvent(ev);
    await this.syncAll();
  }

  async handleEvent(ev: RemoteEvent): Promise<void> {
    if (ev.device_id && ev.device_id === this.deviceId) {
      await this.setCursor(ev.id); // sự kiện do chính phiên này gây ra: đã nhận qua phản hồi
      return;
    }
    if (ev.type === "deleted") {
      this.onRemoteDeleted(ev.note_id);
    } else {
      const local = this.byId(ev.note_id);
      if (local && ev.version <= local.base_version) {
        // đã có phiên bản này
      } else if (local && (local.dirty || local.deleted)) {
        void this.pushNote(local.key);
      } else {
        const r = await this.api.getNote(ev.note_id);
        if (r === null) this.onRemoteDeleted(ev.note_id);
        else this.applyRemote(r);
      }
    }
    await this.setCursor(ev.id);
  }

  /** Cập nhật trạng thái lập chỉ mục (pending/indexing/ready/failed) của một ghi chú đã đồng bộ. */
  async refreshStatus(key: string): Promise<void> {
    const n = this.notes.get(key);
    if (!n || n.id === null || n.dirty || n.deleted) return;
    try {
      const r = await this.api.getNote(n.id);
      const cur = this.notes.get(key);
      if (r && cur && !cur.dirty && r.version === cur.base_version && (r.status !== cur.status || r.has_file !== cur.has_file)) {
        this.set({ ...cur, status: r.status, has_file: r.has_file, file_name: r.file_name });
      }
    } catch {
      // ngoại tuyến: bỏ qua, lần sau thử lại
    }
  }

  /** Dùng sau khi tải lên file (sự kiện do chính thiết bị này gây ra nên không được đẩy lại). */
  async adoptRemote(id: number): Promise<string | null> {
    const r = await this.api.getNote(id);
    if (r === null) return null;
    this.applyRemote(r);
    return this.keyById(id);
  }
}
