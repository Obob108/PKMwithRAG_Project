import test from "node:test";
import assert from "node:assert/strict";
import { SyncEngine } from "../src/lib/engine.ts";
import { FakeServer, MemStore, firstKey, mk } from "./helpers.ts";

test("create and edit push to the server and stay clean", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  await A.engine.init();
  await A.engine.bootstrap();
  const n = A.engine.create("KH", "một\n");
  await A.engine.settle();
  const local = A.engine.notes.get(n.key)!;
  assert.equal(local.id, 1);
  assert.equal(local.base_version, 1);
  assert.equal(local.dirty, false);
  A.engine.edit(n.key, { content: "một\nhai\n" });
  await A.engine.settle();
  assert.equal(server.notes.get(1)!.content, "một\nhai\n");
  assert.equal(server.notes.get(1)!.version, 2);
  assert.equal(A.engine.pendingCount(), 0);
});

test("lost response on create does not duplicate the note (client_id)", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  await A.engine.init();
  A.api.dropNext = true;
  A.engine.create("KH", "x");
  await A.engine.settle();
  assert.equal(server.notes.size, 1); // máy chủ đã tạo, thiết bị chưa biết
  assert.equal(A.engine.notes.get(firstKey(A.engine))!.id, null);
  await A.engine.syncAll();
  await A.engine.settle();
  assert.equal(server.notes.size, 1);
  assert.equal(A.engine.notes.get(firstKey(A.engine))!.id, 1);
  assert.equal(A.engine.pendingCount(), 0);
});

test("offline edits on two devices are merged, not replaced", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  const B = mk(server, "B");
  await A.engine.init(); await B.engine.init();
  await A.engine.bootstrap();
  const created = A.engine.create("KH", "a\nb\nc\nd\n");
  await A.engine.settle();
  await B.engine.bootstrap();
  await B.engine.settle();
  const keyA = created.key;
  const keyB = firstKey(B.engine);

  A.api.offline = true; B.api.offline = true;
  A.engine.edit(keyA, { content: "a\nB\nc\nd\n" });
  B.engine.edit(keyB, { content: "a\nb\nc\nD\n" });
  await A.engine.settle(); await B.engine.settle();
  assert.equal(A.engine.pendingCount(), 1);
  assert.equal(B.engine.pendingCount(), 1);

  A.api.offline = false;
  await A.engine.syncAll(); await A.engine.settle();
  B.api.offline = false;
  await B.engine.catchUp(); await B.engine.settle();
  await A.engine.catchUp(); await A.engine.settle();

  const merged = "a\nB\nc\nD\n";
  assert.equal(server.notes.get(1)!.content, merged);
  assert.equal(A.engine.notes.get(keyA)!.content, merged);
  assert.equal(B.engine.notes.get(keyB)!.content, merged);
  assert.equal(A.engine.pendingCount() + B.engine.pendingCount(), 0);
});

test("typing while a request is in flight is rebased onto the server's merge", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  const B = mk(server, "B");
  await A.engine.init(); await B.engine.init();
  await A.engine.bootstrap();
  const created = A.engine.create("KH", "l1\nl2\nl3\n");
  await A.engine.settle();
  await B.engine.bootstrap();
  B.engine.edit(firstKey(B.engine), { content: "l1\nX2\nl3\n" });
  await B.engine.settle(); // máy chủ ở v2

  let release!: () => void;
  A.api.gate = new Promise<void>((r) => { release = r; });
  A.engine.edit(created.key, { content: "L1\nl2\nl3\n" }); // đang bay: máy chủ gộp thành v3
  A.engine.edit(created.key, { content: "L1\nl2\nL3\n" }); // gõ thêm trong lúc chờ
  release();
  await A.engine.settle();

  assert.equal(server.notes.get(1)!.content, "L1\nX2\nL3\n");
  assert.equal(A.engine.notes.get(created.key)!.content, "L1\nX2\nL3\n");
  assert.equal(A.engine.pendingCount(), 0);
});

test("remote event refetches a clean note; own-device events are ignored", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  const B = mk(server, "B");
  await A.engine.init(); await B.engine.init();
  await A.engine.bootstrap();
  A.engine.create("KH", "v1");
  await A.engine.settle();
  await B.engine.bootstrap();

  A.engine.edit(firstKey(A.engine), { content: "v2" });
  await A.engine.settle();
  const ev = server.events[server.events.length - 1];

  const before = B.api.getCalls;
  await B.engine.handleEvent(ev);
  assert.equal(B.api.getCalls, before + 1);
  assert.equal(B.engine.notes.get(firstKey(B.engine))!.content, "v2");
  assert.equal(B.engine.cursor, ev.id);

  const beforeA = A.api.getCalls;
  await A.engine.handleEvent(ev); // sự kiện do chính A gây ra
  assert.equal(A.api.getCalls, beforeA);
});

test("deleted on one device while edited offline on another: the edit wins and recreates", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  const B = mk(server, "B");
  await A.engine.init(); await B.engine.init();
  await A.engine.bootstrap();
  A.engine.create("KH", "goc");
  await A.engine.settle();
  await B.engine.bootstrap();

  B.api.offline = true;
  B.engine.edit(firstKey(B.engine), { content: "goc + sua o B" });
  await B.engine.settle();
  A.engine.remove(firstKey(A.engine));
  await A.engine.settle();
  assert.equal(server.notes.size, 0);

  B.api.offline = false;
  await B.engine.catchUp();
  await B.engine.settle();
  assert.equal(server.notes.size, 1);
  const [only] = [...server.notes.values()];
  assert.equal(only.content, "goc + sua o B");
  assert.notEqual(only.id, 1);
  assert.equal(B.engine.notes.get(firstKey(B.engine))!.id, only.id);
});

test("update to a note deleted on the server recreates it", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  await A.engine.init();
  await A.engine.bootstrap();
  A.engine.create("KH", "x");
  await A.engine.settle();
  server.remove(1, "B");
  A.engine.edit(firstKey(A.engine), { content: "x sửa" });
  await A.engine.settle();
  assert.equal(server.notes.size, 1);
  assert.equal([...server.notes.values()][0].content, "x sửa");
  assert.equal(A.engine.pendingCount(), 0);
});

test("same-line edits conflict, keep both, and can be resolved", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  const B = mk(server, "B");
  await A.engine.init(); await B.engine.init();
  await A.engine.bootstrap();
  A.engine.create("KH", "a\nb\nc\n");
  await A.engine.settle();
  await B.engine.bootstrap();

  B.api.offline = true;
  B.engine.edit(firstKey(B.engine), { content: "a\nB2\nc\n" });
  A.engine.edit(firstKey(A.engine), { content: "a\nB1\nc\n" });
  await A.engine.settle();
  B.api.offline = false;
  await B.engine.syncAll();
  await B.engine.settle();

  const b = B.engine.notes.get(firstKey(B.engine))!;
  assert.equal(b.has_conflict, true);
  assert.ok(b.content.includes("B1") && b.content.includes("B2"));
  assert.equal(b.dirty, false);

  B.engine.edit(b.key, { content: "a\nB1 và B2\nc\n" });
  await B.engine.settle();
  const fixed = B.engine.notes.get(b.key)!;
  assert.equal(fixed.has_conflict, false);
  assert.equal(server.notes.get(1)!.content, "a\nB1 và B2\nc\n");
  assert.equal(server.notes.get(1)!.has_conflict, false);
});

test("a note created and deleted while offline never reaches the server", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  await A.engine.init();
  A.api.offline = true;
  const n = A.engine.create("tạm", "x");
  await A.engine.settle();
  A.engine.remove(n.key);
  await A.engine.settle();
  A.api.offline = false;
  await A.engine.syncAll();
  assert.equal(server.notes.size, 0);
  assert.equal((await A.store.all()).length, 0);
  assert.equal(A.engine.getSnapshot().length, 0);
});

test("server renames a duplicate title and the device adopts it", async () => {
  const server = new FakeServer();
  server.create({ title: "KH", content: "của B", client_id: "b-1" }, "B");
  const A = mk(server, "A");
  await A.engine.init();
  A.engine.create("KH", "của A");
  await A.engine.settle();
  const mine = A.engine.notes.get(firstKey(A.engine))!;
  assert.equal(mine.title, "KH (2)");
  assert.equal(mine.dirty, false);
});

test("rejected rename (title taken) reverts to the previous title", async () => {
  const server = new FakeServer();
  server.create({ title: "B", content: "x", client_id: null }, "Z");
  const A = mk(server, "A");
  await A.engine.init();
  await A.engine.bootstrap();
  A.engine.create("A", "y");
  await A.engine.settle();
  A.engine.edit(firstKey(A.engine), { title: "B" });
  await A.engine.settle();
  const n = [...A.engine.notes.values()].find((x) => x.id === 2)!;
  assert.equal(n.title, "A");
  assert.equal(n.dirty, false);
});

test("bootstrap reconciles: drops clean notes deleted remotely, recreates dirty ones, adds new ones", async () => {
  const server = new FakeServer();
  for (const t of ["N1", "N2", "N3"]) server.create({ title: t, content: t, client_id: null }, "B");
  const A = mk(server, "A");
  await A.engine.init();
  await A.engine.bootstrap();
  assert.equal(A.engine.getSnapshot().length, 3);

  A.api.offline = true;
  const k3 = A.engine.keyById(3)!;
  A.engine.edit(k3, { content: "N3 sửa dở" });
  await A.engine.settle();
  server.remove(2, "B");
  server.remove(3, "B");
  server.create({ title: "N4", content: "mới", client_id: null }, "B");
  A.api.offline = false;
  await A.engine.bootstrap();
  await A.engine.settle();

  const titles = A.engine.getSnapshot().map((n) => n.title).sort();
  assert.deepEqual(titles, ["N1", "N3", "N4"]);
  assert.ok([...server.notes.values()].some((n) => n.title === "N3" && n.content === "N3 sửa dở"));
});

test("offline work survives a restart (IndexedDB-like store) and is pushed later", async () => {
  const server = new FakeServer();
  const store = new MemStore();
  const one = mk(server, "A", store);
  await one.engine.init();
  await one.engine.bootstrap();
  one.engine.create("KH", "v1");
  await one.engine.settle();
  one.api.offline = true;
  one.engine.edit(firstKey(one.engine), { content: "v1 + chưa gửi" });
  await one.engine.settle();
  one.engine.dispose();

  const two = new SyncEngine(one.api, store, { debounceMs: 0, retry: false, deviceId: "A2" });
  one.api.offline = false;
  await two.init();
  assert.equal(two.pendingCount(), 1);
  assert.equal(two.cursor, 0 + 1 - 1 + two.cursor!); // con trỏ được khôi phục (không null)
  await two.syncAll();
  await two.settle();
  assert.equal(server.notes.get(1)!.content, "v1 + chưa gửi");
});

test("refreshStatus picks up indexing progress without touching content", async () => {
  const server = new FakeServer();
  const A = mk(server, "A");
  await A.engine.init();
  await A.engine.bootstrap();
  A.engine.create("KH", "x");
  await A.engine.settle();
  const key = firstKey(A.engine);
  assert.equal(A.engine.notes.get(key)!.status, "pending");
  server.notes.get(1)!.status = "ready";
  await A.engine.refreshStatus(key);
  assert.equal(A.engine.notes.get(key)!.status, "ready");
  assert.equal(A.engine.notes.get(key)!.content, "x");
  A.api.offline = true;
  server.notes.get(1)!.status = "failed";
  await A.engine.refreshStatus(key); // ngoại tuyến: không lỗi, không đổi
  assert.equal(A.engine.notes.get(key)!.status, "ready");
});
