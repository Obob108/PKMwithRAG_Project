import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoApi, MemoryStore, sections } from "../src/lib/demo.ts";
import { DEMO_LINKS, DEMO_NOTES, DEMO_QA, START_TITLE } from "../src/lib/demoData.ts";
import { SyncEngine } from "../src/lib/engine.ts";

const idOf = async (api: DemoApi, title: string) => (await api.listNotes()).find((n) => n.title === title)!.id;

test("demo data is consistent: every link and Q&A source points at an existing note and heading", () => {
  const titles = new Map(DEMO_NOTES.map((n) => [n.title, n]));
  assert.ok(titles.has(START_TITLE));
  const hasHeading = (title: string, h: string) => {
    const n = titles.get(title);
    assert.ok(n, `thiếu ghi chú ${title}`);
    assert.ok(sections(n.id, n.content).some((s) => s.heading === h), `${title} thiếu heading "${h}"`);
  };
  for (const l of DEMO_LINKS) {
    hasHeading(l.a, l.ha);
    hasHeading(l.b, l.hb);
  }
  for (const qa of DEMO_QA) for (const s of qa.sources) hasHeading(s.title, s.heading);
  // Mọi [[wiki-link]] trong ghi chú mẫu đều trỏ tới ghi chú có thật
  for (const n of DEMO_NOTES) {
    for (const m of n.content.matchAll(/\[\[([^\[\]|#]+?)\]\]/g)) assert.ok(titles.has(m[1]), `${n.title}: [[${m[1]}]] không tồn tại`);
  }
});

test("engine boots the demo vault from memory without any network", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("demo không được gọi mạng"); }) as typeof fetch;
  try {
    const api = new DemoApi();
    const engine = new SyncEngine(api, new MemoryStore(), { deviceId: "demo", debounceMs: 0, retry: false });
    await engine.init();
    await engine.catchUp();
    assert.equal(engine.getSnapshot().length, DEMO_NOTES.length);
    assert.equal(engine.getFolders().length, 3);
    // Khách sửa và tạo ghi chú: đẩy vào bộ nhớ của DemoApi
    const created = engine.create("Ghi chú của khách", "Thử [[dbt]]");
    await engine.pushNote(created.key);
    await engine.settle();
    const remote = (await api.listNotes()).find((n) => n.title === "Ghi chú của khách");
    assert.ok(remote && remote.content.includes("[[dbt]]"));
    engine.dispose();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("related shows AI suggestions the note never links to, with explanations", async () => {
  const api = new DemoApi();
  const dbt = await idOf(api, "dbt");
  const etl = await idOf(api, "ETL và ELT");
  const rel = await api.related(dbt);
  const toEtl = rel.find((r) => r.note_id === etl);
  assert.ok(toEtl && !toEtl.wiki && toEtl.status === "suggested" && toEtl.semantic_score! > 0.8);
  const why = await api.explainLink(dbt, etl);
  assert.equal(why.other_title, "ETL và ELT");
  assert.match(why.pairs[0].other.heading, /ELT/);
});

test("rejecting a suggestion hides it from related and graph; accepting marks the edge", async () => {
  const api = new DemoApi();
  const dbt = await idOf(api, "dbt");
  const etl = await idOf(api, "ETL và ELT");
  const airflow = await idOf(api, "Apache Airflow");
  await api.setLinkStatus(dbt, etl, "rejected");
  assert.ok(!(await api.related(dbt)).some((r) => r.note_id === etl));
  assert.equal((await api.related(dbt, true)).find((r) => r.note_id === etl)?.status, "rejected");
  await api.setLinkStatus(dbt, airflow, "accepted");
  const g = await api.graph();
  const key = (a: number, b: number) => g.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
  assert.equal(key(dbt, etl), undefined);
  assert.equal(key(dbt, airflow)?.accepted, true);
  assert.equal(g.nodes.length, DEMO_NOTES.length);
  assert.ok(g.nodes.every((n) => n.folder_id === null || n.folder_name));
});

test("chat answers sample questions with sources and suggests questions otherwise", async () => {
  const api = new DemoApi();
  const r = await api.chat("etl khác elt chỗ nào vậy?");
  assert.match(r.answer, /ELT/);
  assert.ok(r.sources.length >= 2 && r.sources.some((s) => s.via === "graph"));
  const other = await api.chat("thời tiết hôm nay thế nào");
  assert.equal(other.sources.length, 0);
  assert.match(other.answer, /RAG hoạt động như thế nào/);
});

test("search finds notes without diacritics; uploads are refused politely", async () => {
  const api = new DemoApi();
  const hits = await api.search("ham cua so");
  assert.ok(hits.length && hits.some((h) => h.title === "SQL Window Functions" || h.title === "Ôn thi Cơ sở dữ liệu"));
  await assert.rejects(() => api.upload(), /demo/);
});
