// Chế độ demo cho khách chưa đăng nhập: cùng giao diện với HttpApi nhưng chạy hoàn toàn trên trình duyệt,
// dữ liệu là bộ ghi chú mẫu (demoData.ts), lưu trong bộ nhớ và mất khi tải lại trang.
// Không gọi máy chủ: không tốn hạn mức Gemini, không ai ghi được vào cơ sở dữ liệu, xem được cả khi backend tắt.
// Phần "AI" ở đây là minh họa: gợi ý liên kết tính sẵn, tìm kiếm theo từ khóa, hỏi đáp theo câu mẫu.
import { HttpApi } from "./api.ts";
import type { ChatSource, LinkExplanation, LinkStatus, RelatedItem, SearchHit, Session } from "./api.ts";
import { DEMO_FOLDERS, DEMO_LINKS, DEMO_NOTES, DEMO_QA } from "./demoData.ts";
import type { DemoLink } from "./demoData.ts";
import type { GraphData, GEdge } from "./graphModel.ts";
import { fold } from "./text.ts";
import { ApiError } from "./types.ts";
import type { Folder, LocalNote, RemoteEvent, RemoteNote, Store, UpdateResult } from "./types.ts";

export const DEMO_SESSION: Session = { token: "", username: "Khách", userId: 0 };

const DEMO_ONLY = "Bản demo không hỗ trợ tải file lên. Đăng ký miễn phí để lưu PDF, ảnh và ghi chú của bạn.";
const WIKI_RE = /\[\[([^\[\]|#]+?)(?:[#|][^\[\]]*)?\]\]/g;

/** Kho cục bộ trong bộ nhớ (thay IndexedDB): demo không để lại dữ liệu trên máy khách. */
export class MemoryStore implements Store {
  private notes = new Map<string, LocalNote>();
  private meta = new Map<string, unknown>();
  async all(): Promise<LocalNote[]> {
    return [...this.notes.values()];
  }
  async put(note: LocalNote): Promise<void> {
    this.notes.set(note.key, note);
  }
  async remove(key: string): Promise<void> {
    this.notes.delete(key);
  }
  async getMeta(key: string): Promise<unknown> {
    return this.meta.get(key);
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }
}

interface Section {
  chunk_id: number;
  heading: string;
  text: string;
}

/** Tách ghi chú theo heading (giống chunking phía máy chủ, giản lược): heading = tiêu đề cấp gần nhất. */
export function sections(noteId: number, content: string): Section[] {
  const out: Section[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ chunk_id: noteId * 100 + out.length, heading, text });
    buf = [];
  };
  let fence = false;
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : line.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (m) {
      flush();
      heading = m[1];
    } else buf.push(line);
  }
  flush();
  return out;
}

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export class DemoApi extends HttpApi {
  private notes = new Map<number, RemoteNote>();
  private folders = new Map<number, Folder>();
  private status = new Map<string, LinkStatus>(); // quyết định ✓/✗ theo cặp ghi chú
  private nextNote = 100;
  private nextFolder = 10;
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    super({ deviceId: "demo", getToken: () => null });
    this.now = opts.now ?? (() => Date.now());
    const t0 = this.now();
    for (const f of DEMO_FOLDERS) this.folders.set(f.id, { id: f.id, name: f.name, created_at: new Date(t0).toISOString() });
    // Ghi chú mẫu có thời điểm sửa khác nhau để "ghi chú gần đây" trên trang chủ trông tự nhiên.
    DEMO_NOTES.forEach((n, i) => {
      this.notes.set(n.id, {
        id: n.id, title: n.title, content: n.content, version: 1, has_conflict: false, status: "ready",
        updated_at: new Date(t0 - i * 3_600_000).toISOString(), source: "md", has_file: false, file_name: null,
        folder_id: n.folder_id,
      });
    });
  }

  // ------------------------------------------------------------ đồng bộ (engine)
  async listNotes(): Promise<RemoteNote[]> {
    return [...this.notes.values()].map((n) => ({ ...n }));
  }
  async cursor(): Promise<number> {
    return 0;
  }
  async changes(_since: number): Promise<{ cursor: number; events: RemoteEvent[] }> {
    return { cursor: 0, events: [] };
  }
  async getNote(id: number): Promise<RemoteNote | null> {
    const n = this.notes.get(id);
    return n ? { ...n } : null;
  }
  private uniqueTitle(title: string, exceptId?: number): string {
    const base = title.trim() || "Không có tiêu đề";
    const taken = (t: string) => [...this.notes.values()].some((n) => n.id !== exceptId && n.title === t);
    let candidate = base;
    for (let i = 2; taken(candidate); i++) candidate = `${base} (${i})`;
    return candidate;
  }
  private validFolder(id: number | null | undefined): number | null {
    return id != null && this.folders.has(id) ? id : null;
  }
  async createNote(input: { title: string; content: string; client_id: string; folder_id?: number | null }): Promise<RemoteNote> {
    const n: RemoteNote = {
      id: this.nextNote++, title: this.uniqueTitle(input.title), content: input.content, version: 1, has_conflict: false,
      status: "ready", updated_at: new Date(this.now()).toISOString(), source: "md", has_file: false, file_name: null,
      folder_id: this.validFolder(input.folder_id),
    };
    this.notes.set(n.id, n);
    return { ...n };
  }
  async updateNote(id: number, input: { content: string; base_version: number; title?: string; folder_id?: number | null }): Promise<UpdateResult> {
    const n = this.notes.get(id);
    if (!n) return { kind: "notfound" };
    let title = n.title;
    if (input.title !== undefined && input.title.trim() && input.title.trim() !== n.title) {
      title = input.title.trim();
      if ([...this.notes.values()].some((o) => o.id !== id && o.title === title)) return { kind: "title_taken" };
    }
    const next: RemoteNote = {
      ...n, title, content: input.content, version: n.version + 1, updated_at: new Date(this.now()).toISOString(),
      folder_id: "folder_id" in input ? this.validFolder(input.folder_id) : n.folder_id,
    };
    this.notes.set(id, next);
    return { kind: "ok", result: "ok", note: { ...next } };
  }
  async deleteNote(id: number): Promise<void> {
    this.notes.delete(id);
  }

  // ------------------------------------------------------------ thư mục
  async listFolders(): Promise<Folder[]> {
    return [...this.folders.values()].map((f) => ({ ...f }));
  }
  private checkFolderName(name: string, exceptId?: number): string {
    const clean = name.trim();
    if (!clean) throw new ApiError(422, "Tên thư mục không được để trống");
    if ([...this.folders.values()].some((f) => f.id !== exceptId && fold(f.name) === fold(clean))) {
      throw new ApiError(409, "Đã có thư mục cùng tên");
    }
    return clean;
  }
  async createFolder(name: string): Promise<Folder> {
    const f = { id: this.nextFolder++, name: this.checkFolderName(name), created_at: new Date(this.now()).toISOString() };
    this.folders.set(f.id, f);
    return { ...f };
  }
  async renameFolder(id: number, name: string): Promise<Folder> {
    const f = this.folders.get(id);
    if (!f) throw new ApiError(404, "Không tìm thấy thư mục");
    const next = { ...f, name: this.checkFolderName(name, id) };
    this.folders.set(id, next);
    return { ...next };
  }
  async deleteFolder(id: number): Promise<void> {
    this.folders.delete(id);
    for (const n of this.notes.values()) if (n.folder_id === id) this.notes.set(n.id, { ...n, folder_id: null, version: n.version + 1 });
  }

  // ------------------------------------------------------------ liên kết ngữ nghĩa (tính sẵn)
  private byTitle(title: string): RemoteNote | undefined {
    return [...this.notes.values()].find((n) => n.title === title);
  }
  /** Các gợi ý còn hiệu lực: cả hai ghi chú vẫn còn (khách có thể đã xóa/đổi tên). */
  private semanticLinks(): { a: RemoteNote; b: RemoteNote; def: DemoLink; status: LinkStatus }[] {
    const out: { a: RemoteNote; b: RemoteNote; def: DemoLink; status: LinkStatus }[] = [];
    for (const def of DEMO_LINKS) {
      const a = this.byTitle(def.a);
      const b = this.byTitle(def.b);
      if (a && b) out.push({ a, b, def, status: this.status.get(pairKey(a.id, b.id)) ?? "suggested" });
    }
    return out;
  }
  private wikiPairs(): [number, number][] {
    const out: [number, number][] = [];
    for (const n of this.notes.values()) {
      const seen = new Set<number>();
      for (const m of n.content.matchAll(WIKI_RE)) {
        const t = this.byTitle(m[1].trim());
        if (t && t.id !== n.id && !seen.has(t.id)) {
          seen.add(t.id);
          out.push([n.id, t.id]);
        }
      }
    }
    return out;
  }
  async related(id: number, includeRejected = false): Promise<RelatedItem[]> {
    if (!this.notes.has(id)) throw new ApiError(404, "Không tìm thấy ghi chú");
    const items = new Map<number, RelatedItem>();
    const get = (other: RemoteNote) => {
      let it = items.get(other.id);
      if (!it) items.set(other.id, (it = { note_id: other.id, title: other.title, semantic_score: null, wiki: false, status: null }));
      return it;
    };
    for (const [s, d] of this.wikiPairs()) {
      if (s === id || d === id) get(this.notes.get(s === id ? d : s) as RemoteNote).wiki = true;
    }
    for (const l of this.semanticLinks()) {
      if (l.a.id !== id && l.b.id !== id) continue;
      if (l.status === "rejected" && !includeRejected) continue;
      const it = get(l.a.id === id ? l.b : l.a);
      it.semantic_score = l.def.score;
      it.status = l.status;
    }
    const rank = (r: RelatedItem) => (r.status === "accepted" ? 0 : r.wiki ? 1 : 2);
    return [...items.values()].sort((x, y) => rank(x) - rank(y) || (y.semantic_score ?? 0) - (x.semantic_score ?? 0));
  }
  async explainLink(id: number, otherId: number): Promise<LinkExplanation> {
    const l = this.semanticLinks().find((x) => pairKey(x.a.id, x.b.id) === pairKey(id, otherId));
    if (!l) throw new ApiError(404, "Hai ghi chú này không có gợi ý liên kết");
    const [mine, theirs, hMine, hTheirs] = l.a.id === id ? [l.a, l.b, l.def.ha, l.def.hb] : [l.b, l.a, l.def.hb, l.def.ha];
    const pick = (n: RemoteNote, h: string) => {
      const secs = sections(n.id, n.content);
      const s = secs.find((x) => x.heading === h) ?? secs[0] ?? { chunk_id: n.id * 100, heading: "", text: n.content };
      return { chunk_id: s.chunk_id, heading: s.heading, text: s.text.slice(0, 400) };
    };
    return {
      note_id: id, other_id: otherId, other_title: theirs.title, score: l.def.score, n_pairs: 1, status: l.status,
      pairs: [{ score: l.def.score, this: pick(mine, hMine), other: pick(theirs, hTheirs) }],
    };
  }
  async setLinkStatus(id: number, otherId: number, status: LinkStatus): Promise<{ status: LinkStatus; score: number }> {
    const l = this.semanticLinks().find((x) => pairKey(x.a.id, x.b.id) === pairKey(id, otherId));
    if (!l) throw new ApiError(404, "Hai ghi chú này không có gợi ý liên kết");
    if (status === "suggested") this.status.delete(pairKey(id, otherId));
    else this.status.set(pairKey(id, otherId), status);
    return { status, score: l.def.score };
  }
  async graph(minScore = 0): Promise<GraphData> {
    const edges = new Map<string, GEdge>();
    const edge = (a: number, b: number) => {
      const k = pairKey(a, b);
      let e = edges.get(k);
      if (!e) edges.set(k, (e = { source: Math.min(a, b), target: Math.max(a, b), semantic_score: null, wiki: false }));
      return e;
    };
    for (const [s, d] of this.wikiPairs()) edge(s, d).wiki = true;
    for (const l of this.semanticLinks()) {
      if (l.status === "rejected" || (l.def.score < minScore && l.status !== "accepted")) continue;
      const e = edge(l.a.id, l.b.id);
      e.semantic_score = l.def.score;
      if (l.status === "accepted") e.accepted = true;
    }
    const degree = new Map<number, number>();
    for (const e of edges.values()) for (const v of [e.source, e.target]) degree.set(v, (degree.get(v) ?? 0) + 1);
    const nodes = [...this.notes.values()].map((n) => ({
      id: n.id, title: n.title, source: n.source, has_file: false, degree: degree.get(n.id) ?? 0,
      folder_id: n.folder_id, folder_name: n.folder_id !== null ? this.folders.get(n.folder_id)?.name ?? null : null,
    }));
    return { nodes, edges: [...edges.values()], folders: [...this.folders.values()].map((f) => ({ id: f.id, name: f.name })) };
  }

  // ------------------------------------------------------------ tìm kiếm & hỏi đáp (minh họa)
  /** Bản demo tìm theo từ khóa (không dấu); bản thật tìm theo nghĩa bằng embedding BGE-m3. */
  async search(q: string, limit = 10): Promise<SearchHit[]> {
    const qs = [...new Set(words(q))];
    if (!qs.length) return [];
    const hits: SearchHit[] = [];
    for (const n of this.notes.values()) {
      for (const s of sections(n.id, n.content)) {
        const have = new Set(words(`${n.title} ${s.heading} ${s.text}`));
        const matched = qs.filter((w) => have.has(w)).length;
        if (!matched) continue;
        hits.push({ note_id: n.id, chunk_id: s.chunk_id, title: n.title, heading: s.heading, snippet: s.text.slice(0, 200),
                    score: Math.round((0.45 + 0.45 * (matched / qs.length)) * 1000) / 1000 });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  async chat(question: string): Promise<{ answer: string; sources: ChatSource[] }> {
    const q = ` ${fold(question)} `;
    let best: (typeof DEMO_QA)[number] | null = null;
    let bestHits = 0;
    for (const qa of DEMO_QA) {
      const hits = qa.keywords.filter((k) => q.includes(k)).length;
      if (hits > bestHits) [best, bestHits] = [qa, hits];
    }
    await new Promise((r) => setTimeout(r, 600)); // cho cảm giác "đang suy nghĩ" giống bản thật
    if (!best) {
      return {
        answer: "Đây là bản demo nên trợ lý chỉ trả lời được một số câu hỏi mẫu về các ghi chú có sẵn. Hãy thử:\n\n" +
          DEMO_QA.map((x) => `- ${x.question}`).join("\n") +
          "\n\nKhi đăng ký, trợ lý sẽ trả lời mọi câu hỏi dựa trên chính ghi chú của bạn, kèm nguồn trích dẫn.",
        sources: [],
      };
    }
    const sources: ChatSource[] = [];
    best.sources.forEach((src, i) => {
      const n = this.byTitle(src.title);
      if (!n) return;
      const secs = sections(n.id, n.content);
      const s = secs.find((x) => x.heading === src.heading) ?? secs[0];
      if (!s) return;
      sources.push({ n: i + 1, note_id: n.id, chunk_id: s.chunk_id, title: n.title, heading: s.heading, via: src.via,
                     score: 0, vector_score: 0, snippet: s.text.slice(0, 160) });
    });
    return { answer: best.answer, sources };
  }

  // ------------------------------------------------------------ file: không hỗ trợ trong demo
  async upload(): Promise<RemoteNote> {
    throw new ApiError(403, DEMO_ONLY);
  }
  async uploadAttachment(): Promise<{ name: string; mime: string; size: number }> {
    throw new ApiError(403, DEMO_ONLY);
  }
  async fetchAttachment(): Promise<Blob> {
    throw new ApiError(404, "Bản demo không có ảnh đính kèm");
  }
  async fetchFile(): Promise<Blob> {
    throw new ApiError(404, "Bản demo không có file PDF");
  }
}
