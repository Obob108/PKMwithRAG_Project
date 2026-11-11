// Máy chủ giả + kho nhớ tạm để kiểm thử engine đồng bộ mà không cần mạng thật.
import { SyncEngine } from "../src/lib/engine.ts";
import { conflictBlock, hasConflictMarkers, mergeText } from "../src/lib/merge.ts";
import { NetworkError } from "../src/lib/types.ts";
import type { Api, LocalNote, RemoteEvent, RemoteNote, Store, UpdateResult } from "../src/lib/types.ts";

type ServerNote = RemoteNote & { client_id: string | null };
const pub = (n: ServerNote): RemoteNote => {
  const { client_id: _ignored, ...rest } = n;
  return { ...rest };
};

export class FakeServer {
  nextId = 1;
  nextEvent = 1;
  clock = 0;
  notes = new Map<number, ServerNote>();
  versions = new Map<string, { title: string; content: string }>();
  events: RemoteEvent[] = [];

  ts(): string {
    return "2026-11-09 08:00:" + String(this.clock++ % 60).padStart(2, "0");
  }
  emit(type: RemoteEvent["type"], id: number, version: number, device: string | null): void {
    this.events.push({ id: this.nextEvent++, type, note_id: id, version, device_id: device });
  }
  uniqueTitle(t: string): string {
    const titles = new Set([...this.notes.values()].map((n) => n.title));
    let c = t;
    for (let i = 2; titles.has(c); i++) c = `${t} (${i})`;
    return c;
  }
  create(input: { title: string; content: string; client_id: string | null }, device: string | null): RemoteNote {
    for (const n of this.notes.values()) if (input.client_id && n.client_id === input.client_id) return pub(n);
    const id = this.nextId++;
    const n: ServerNote = {
      id, title: this.uniqueTitle(input.title), content: input.content, version: 1,
      has_conflict: hasConflictMarkers(input.content), status: "pending", updated_at: this.ts(),
      source: "md", has_file: false, file_name: null, client_id: input.client_id,
    };
    this.notes.set(id, n);
    this.versions.set(`${id}:1`, { title: n.title, content: n.content });
    this.emit("created", id, 1, device);
    return pub(n);
  }
  update(id: number, input: { content: string; base_version: number; title?: string }, device: string | null): UpdateResult {
    const n = this.notes.get(id);
    if (!n) return { kind: "notfound" };
    if (input.base_version < 1 || input.base_version > n.version) return { kind: "bad_version" };
    let content: string;
    let result: "ok" | "merged" | "conflict";
    let title = n.title;
    if (input.base_version === n.version) {
      content = input.content;
      result = "ok";
      if (input.title && input.title.trim()) title = input.title.trim();
    } else {
      const base = this.versions.get(`${id}:${input.base_version}`);
      const m = base ? mergeText(base.content, n.content, input.content) : { text: conflictBlock(n.content, input.content), conflict: true };
      content = m.text;
      result = m.conflict ? "conflict" : "merged";
      if (base && input.title && input.title !== base.title && n.title === base.title) title = input.title.trim();
    }
    if (title !== n.title && [...this.notes.values()].some((o) => o.id !== id && o.title === title)) return { kind: "title_taken" };
    if (content !== n.content || title !== n.title) {
      n.version += 1;
      n.content = content;
      n.title = title;
      n.has_conflict = hasConflictMarkers(content);
      n.status = "pending";
      n.updated_at = this.ts();
      this.versions.set(`${id}:${n.version}`, { title, content });
      this.emit("updated", id, n.version, device);
    }
    return { kind: "ok", result, note: pub(n) };
  }
  remove(id: number, device: string | null): void {
    const n = this.notes.get(id);
    if (!n) return;
    this.notes.delete(id);
    this.emit("deleted", id, n.version, device);
  }
}

export class FakeApi implements Api {
  server: FakeServer;
  device: string;
  offline = false;
  dropNext = false; // thực hiện trên máy chủ rồi làm mất phản hồi
  gate: Promise<void> | null = null; // giữ phản hồi updateNote lại
  getCalls = 0;

  constructor(server: FakeServer, device: string) {
    this.server = server;
    this.device = device;
  }
  private check(): void {
    if (this.offline) throw new NetworkError("offline");
  }
  async listNotes(): Promise<RemoteNote[]> {
    this.check();
    return [...this.server.notes.values()].map(pub);
  }
  async cursor(): Promise<number> {
    this.check();
    return this.server.nextEvent - 1;
  }
  async changes(since: number): Promise<{ cursor: number; events: RemoteEvent[] }> {
    this.check();
    const events = this.server.events.filter((e) => e.id > since);
    return { cursor: events.length ? events[events.length - 1].id : since, events };
  }
  async getNote(id: number): Promise<RemoteNote | null> {
    this.check();
    this.getCalls++;
    const n = this.server.notes.get(id);
    return n ? pub(n) : null;
  }
  async createNote(input: { title: string; content: string; client_id: string }): Promise<RemoteNote> {
    this.check();
    const r = this.server.create(input, this.device);
    if (this.dropNext) {
      this.dropNext = false;
      throw new NetworkError("response lost");
    }
    return r;
  }
  async updateNote(id: number, input: { content: string; base_version: number; title?: string }): Promise<UpdateResult> {
    this.check();
    const r = this.server.update(id, input, this.device);
    if (this.gate) await this.gate;
    if (this.dropNext) {
      this.dropNext = false;
      throw new NetworkError("response lost");
    }
    return r;
  }
  async deleteNote(id: number): Promise<void> {
    this.check();
    this.server.remove(id, this.device);
  }
}

export class MemStore implements Store {
  notes = new Map<string, LocalNote>();
  meta = new Map<string, unknown>();
  async all(): Promise<LocalNote[]> {
    return [...this.notes.values()].map((n) => structuredClone(n));
  }
  async put(n: LocalNote): Promise<void> {
    this.notes.set(n.key, structuredClone(n));
  }
  async remove(key: string): Promise<void> {
    this.notes.delete(key);
  }
  async getMeta(k: string): Promise<unknown> {
    return this.meta.get(k);
  }
  async setMeta(k: string, v: unknown): Promise<void> {
    this.meta.set(k, v);
  }
}

export function mk(server: FakeServer, device: string, store: MemStore = new MemStore()) {
  let n = 0;
  let clock = 1000;
  const api = new FakeApi(server, device);
  const engine = new SyncEngine(api, store, {
    debounceMs: 0, retry: false, deviceId: device, uuid: () => `${device}-${++n}`, now: () => ++clock,
  });
  return { engine, api, store };
}

export const firstKey = (e: SyncEngine): string => [...e.notes.keys()][0];
