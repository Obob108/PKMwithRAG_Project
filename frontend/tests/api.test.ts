import test from "node:test";
import assert from "node:assert/strict";
import { HttpApi, login, parseSseBlock, register } from "../src/lib/api.ts";
import { ApiError, NetworkError } from "../src/lib/types.ts";
import type { RemoteEvent } from "../src/lib/types.ts";

type Call = { url: string; init: RequestInit };
function stub(handler: (url: string, init: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const api = () => new HttpApi({ deviceId: "dev-1", getToken: () => "tok" });

test("requests carry the bearer token and device id", async () => {
  const calls = stub(() => json({ cursor: 7, events: [] }));
  assert.equal(await api().cursor(), 7);
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer tok");
  assert.equal(h["X-Device-Id"], "dev-1");
  assert.equal(calls[0].url, "/api/sync/changes");
});

test("updateNote maps HTTP outcomes to engine results", async () => {
  const note = { id: 1, title: "T", content: "c", version: 2, has_conflict: false, status: "pending", updated_at: "x", source: "md", has_file: false, file_name: null };
  stub(() => json({ result: "merged", note }));
  assert.deepEqual(await api().updateNote(1, { content: "c", base_version: 1 }), { kind: "ok", result: "merged", note });
  stub(() => json({ detail: "Không tìm thấy ghi chú" }, 404));
  assert.deepEqual(await api().updateNote(1, { content: "c", base_version: 1 }), { kind: "notfound" });
  stub(() => json({ detail: "Đã có ghi chú khác dùng tiêu đề này" }, 409));
  assert.deepEqual(await api().updateNote(1, { content: "c", base_version: 1 }), { kind: "title_taken" });
  stub(() => json({ detail: "base_version không hợp lệ" }, 409));
  assert.deepEqual(await api().updateNote(1, { content: "c", base_version: 1 }), { kind: "bad_version" });
  stub(() => json({ detail: "hết phiên" }, 401));
  await assert.rejects(() => api().updateNote(1, { content: "c", base_version: 1 }), (e: unknown) => e instanceof ApiError && e.status === 401);
});

test("network failures become NetworkError; 404 on getNote is null; delete 404 is fine", async () => {
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  await assert.rejects(() => api().listNotes(), (e: unknown) => e instanceof NetworkError);
  stub(() => json({ detail: "x" }, 404));
  assert.equal(await api().getNote(5), null);
  await api().deleteNote(5);
});

test("login and register build a session via /api/me", async () => {
  const calls = stub((url) => url.endsWith("/api/me") ? json({ id: 9, username: "alice" }) : json({ access_token: "T", token_type: "bearer" }));
  const s = await login("", "alice", "pw");
  assert.deepEqual(s, { token: "T", username: "alice", userId: 9 });
  assert.equal(calls[0].init.body, "username=alice&password=pw");
  const r = await register("", "bob", "matkhau-dai", "ma");
  assert.equal(r.token, "T");
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { username: "bob", password: "matkhau-dai", invite_code: "ma" });
  stub(() => json({ detail: "Sai tên đăng nhập hoặc mật khẩu" }, 401));
  await assert.rejects(() => login("", "a", "b"), (e: unknown) => e instanceof ApiError && e.detail.includes("Sai"));
});

test("SSE block parsing", () => {
  assert.deepEqual(parseSseBlock('id: 3\nevent: note\ndata: {"a":1}'), { event: "note", data: '{"a":1}' });
  assert.equal(parseSseBlock(": keepalive"), null);
  assert.equal(parseSseBlock("retry: 3000"), null);
});

test("streamEvents delivers events split across chunks and ends when the stream closes", async () => {
  const enc = new TextEncoder();
  const ev = (id: number): RemoteEvent => ({ id, type: "updated", note_id: 1, version: id, device_id: null });
  const frame = (e: RemoteEvent) => `id: ${e.id}\nevent: note\ndata: ${JSON.stringify(e)}\n\n`;
  const text = "retry: 3000\n\n" + frame(ev(1)) + ": keepalive\n\n" + frame(ev(2));
  const cut = Math.floor(text.length / 2);
  stub(() => new Response(new ReadableStream({
    start(c) { c.enqueue(enc.encode(text.slice(0, cut))); c.enqueue(enc.encode(text.slice(cut))); c.close(); },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  const got: number[] = [];
  await api().streamEvents(0, (e) => { got.push(e.id); }, new AbortController().signal);
  assert.deepEqual(got, [1, 2]);
});
