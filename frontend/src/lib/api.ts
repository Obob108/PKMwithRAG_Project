// Máy khách HTTP cho backend (đăng nhập, ghi chú, đồng bộ, hỏi đáp, SSE).
import { ApiError, NetworkError } from "./types.ts";
import type { Api, RemoteEvent, RemoteNote, UpdateResult } from "./types.ts";
import type { GraphData } from "./graphModel.ts";

export interface Session {
  token: string;
  username: string;
  userId: number;
}
export interface PublicConfig {
  allow_registration: boolean;
  invite_required: boolean;
}
export interface RelatedItem {
  note_id: number;
  title: string;
  semantic_score: number | null;
  wiki: boolean;
}
export interface ChatSource {
  n: number;
  note_id: number;
  chunk_id: number;
  title: string;
  heading: string;
  via: string;
  score: number;
  vector_score: number;
  snippet: string;
}
export interface SearchHit {
  note_id: number;
  chunk_id: number;
  title: string;
  heading: string;
  snippet: string;
  score: number;
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}

export function detailOf(body: unknown): string {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x as { msg?: string }).msg ?? "").filter(Boolean).join("; ");
  return "";
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function readError(res: Response): Promise<ApiError> {
  return new ApiError(res.status, detailOf(await safeJson(res)) || res.statusText || `HTTP ${res.status}`);
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- xác thực (không cần token)
export async function getConfig(base = ""): Promise<PublicConfig> {
  const res = await doFetch(`${base}/api/config`, {});
  if (!res.ok) throw await readError(res);
  return (await res.json()) as PublicConfig;
}

async function sessionFromToken(base: string, token: string): Promise<Session> {
  const res = await doFetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await readError(res);
  const me = (await res.json()) as { id: number; username: string };
  return { token, username: me.username, userId: me.id };
}

export async function login(base: string, username: string, password: string): Promise<Session> {
  const res = await doFetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }).toString(),
  });
  if (!res.ok) throw await readError(res);
  const { access_token } = (await res.json()) as { access_token: string };
  return sessionFromToken(base, access_token);
}

export async function register(base: string, username: string, password: string, inviteCode?: string): Promise<Session> {
  const res = await doFetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, invite_code: inviteCode || null }),
  });
  if (!res.ok) throw await readError(res);
  const { access_token } = (await res.json()) as { access_token: string };
  return sessionFromToken(base, access_token);
}

// ---------------------------------------------------------------- SSE
export function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

// ---------------------------------------------------------------- API đã xác thực
export class HttpApi implements Api {
  base: string;
  deviceId: string;
  getToken: () => string | null;

  constructor(opts: { base?: string; deviceId: string; getToken: () => string | null }) {
    this.base = opts.base ?? "";
    this.deviceId = opts.deviceId;
    this.getToken = opts.getToken;
  }

  private request(method: string, path: string,
                  opts: { json?: unknown; form?: FormData; signal?: AbortSignal; accept?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { "X-Device-Id": this.deviceId };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.accept) headers.Accept = opts.accept;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) body = opts.form;
    return doFetch(`${this.base}${path}`, { method, headers, body, signal: opts.signal });
  }

  private async json<T>(method: string, path: string, opts: { json?: unknown; form?: FormData } = {}): Promise<T> {
    const res = await this.request(method, path, opts);
    if (!res.ok) throw await readError(res);
    return (await res.json()) as T;
  }

  // --- giao diện Api của engine
  listNotes(): Promise<RemoteNote[]> {
    return this.json<RemoteNote[]>("GET", "/api/notes?full=true");
  }
  async cursor(): Promise<number> {
    return (await this.json<{ cursor: number }>("GET", "/api/sync/changes")).cursor;
  }
  changes(since: number): Promise<{ cursor: number; events: RemoteEvent[] }> {
    return this.json("GET", `/api/sync/changes?since=${since}`);
  }
  async getNote(id: number): Promise<RemoteNote | null> {
    const res = await this.request("GET", `/api/notes/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await readError(res);
    return (await res.json()) as RemoteNote;
  }
  createNote(input: { title: string; content: string; client_id: string }): Promise<RemoteNote> {
    return this.json<RemoteNote>("POST", "/api/notes", { json: input });
  }
  async updateNote(id: number, input: { content: string; base_version: number; title?: string }): Promise<UpdateResult> {
    const res = await this.request("PUT", `/api/notes/${id}`, { json: input });
    if (res.ok) {
      const b = (await res.json()) as { result: "ok" | "merged" | "conflict"; note: RemoteNote };
      return { kind: "ok", result: b.result, note: b.note };
    }
    if (res.status === 404) return { kind: "notfound" };
    if (res.status === 409) return /tiêu đề/i.test(detailOf(await safeJson(res))) ? { kind: "title_taken" } : { kind: "bad_version" };
    throw await readError(res);
  }
  async deleteNote(id: number): Promise<void> {
    const res = await this.request("DELETE", `/api/notes/${id}`);
    if (!res.ok && res.status !== 404) throw await readError(res);
  }

  // --- tính năng khác
  related(id: number): Promise<RelatedItem[]> {
    return this.json("GET", `/api/notes/${id}/related`);
  }
  graph(minScore = 0): Promise<GraphData> {
    return this.json("GET", `/api/graph?min_score=${minScore}`);
  }
  search(q: string, limit = 10): Promise<SearchHit[]> {
    return this.json("GET", `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }
  chat(question: string, useGraph?: boolean): Promise<{ answer: string; sources: ChatSource[] }> {
    return this.json("POST", "/api/chat", { json: { question, use_graph: useGraph ?? null } });
  }
  upload(file: File): Promise<RemoteNote> {
    const form = new FormData();
    form.append("file", file);
    return this.json("POST", "/api/notes/upload", { form });
  }
  /** PDF gốc, tải bằng fetch có token rồi hiển thị bằng blob URL (iframe không gửi được header). */
  async fetchFile(id: number): Promise<Blob> {
    const res = await this.request("GET", `/api/notes/${id}/file`);
    if (!res.ok) throw await readError(res);
    return await res.blob();
  }

  /** Server-Sent Events qua fetch (EventSource không gửi được header Authorization). Trả về khi luồng đóng. */
  async streamEvents(since: number, onEvent: (ev: RemoteEvent) => Promise<void> | void, signal: AbortSignal): Promise<void> {
    const res = await this.request("GET", `/api/events?since=${since}`, { signal, accept: "text/event-stream" });
    if (!res.ok) throw await readError(res);
    if (!res.body) throw new NetworkError("Trình duyệt không hỗ trợ đọc luồng sự kiện");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (isAbort(e) || signal.aborted) return;
        throw new NetworkError(e instanceof Error ? e.message : String(e));
      }
      if (chunk.done) return;
      buf += dec.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const parsed = parseSseBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (parsed && parsed.event === "note") await onEvent(JSON.parse(parsed.data) as RemoteEvent);
      }
    }
  }
}
