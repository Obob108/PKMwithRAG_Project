import test from "node:test";
import assert from "node:assert/strict";
import {
  FOLDER_PALETTE, NO_FOLDER_COLOR, boundsOf, buildView, createSim, folderColors, folderKey, highlightSet, hitTest, isSettled,
  densityCutoffs, matchNodes, neighborSet, quantile, stepSim,
} from "../src/lib/graphModel.ts";
import type { GEdge, GNode, GraphData } from "../src/lib/graphModel.ts";

const node = (id: number, source = "md"): GNode => ({ id, title: `N${id}`, source, has_file: source === "pdf", degree: 0 });
const edge = (a: number, b: number, score: number | null, wiki = false): GEdge => ({ source: a, target: b, semantic_score: score, wiki });
const data: GraphData = {
  nodes: [node(1), node(2), node(3), node(4), node(5, "pdf")],
  edges: [edge(1, 2, 0.8), edge(2, 3, 0.6), edge(3, 4, null, true), edge(1, 3, 0.5)],
};
const base = { minScore: 0.0, showOrphans: false, focusId: null, depth: 1 };

test("orphans are hidden by default and recounted degrees are correct", () => {
  const v = buildView(data, base);
  assert.deepEqual(v.nodes.map((n) => n.id), [1, 2, 3, 4]);
  assert.deepEqual(Object.fromEntries(v.nodes.map((n) => [n.id, n.degree])), { 1: 2, 2: 2, 3: 3, 4: 1 });
  assert.equal(buildView(data, { ...base, showOrphans: true }).nodes.length, 5);
});

test("min score drops weak semantic edges (wiki edges always stay) and the nodes that become isolated", () => {
  const v = buildView(data, { ...base, minScore: 0.7 });
  assert.deepEqual(v.edges.map((e) => [e.source, e.target]), [[1, 2], [3, 4]]);
  assert.deepEqual(v.nodes.map((n) => n.id).sort(), [1, 2, 3, 4]);
  const strict = buildView(data, { ...base, minScore: 0.9 });
  assert.deepEqual(strict.nodes.map((n) => n.id), [3, 4]);
});

test("accepted semantic edges stay visible above any min score, like wiki edges", () => {
  const d: GraphData = { nodes: data.nodes, edges: [{ ...edge(1, 2, 0.66), accepted: true }, edge(2, 3, 0.9)] };
  const v = buildView(d, { ...base, minScore: 0.95 });
  assert.deepEqual(v.edges.map((e) => [e.source, e.target]), [[1, 2]]);
});

test("local graph around a focus note with depth", () => {
  const d1 = buildView(data, { ...base, focusId: 4, depth: 1 });
  assert.deepEqual(d1.nodes.map((n) => n.id).sort(), [3, 4]);
  const d2 = buildView(data, { ...base, focusId: 4, depth: 2 });
  assert.deepEqual(d2.nodes.map((n) => n.id).sort(), [1, 2, 3, 4]);
  const orphanFocus = buildView(data, { ...base, focusId: 5, depth: 1 });
  assert.deepEqual(orphanFocus.nodes.map((n) => n.id), [5]); // ghi chú đang xem luôn hiện
});

test("neighbours and highlight set", () => {
  assert.deepEqual([...neighborSet(data.edges, 3)].sort(), [1, 2, 4]);
  assert.deepEqual([...highlightSet(data.edges, 4)!].sort(), [3, 4]);
  assert.equal(highlightSet(data.edges, null), null);
});

test("sim keeps previous positions and stays finite", () => {
  const view = buildView(data, base);
  const sim = createSim(view);
  for (let i = 0; i < 200; i++) stepSim(sim);
  assert.ok(sim.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const prev = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const again = createSim(view, prev);
  assert.deepEqual(again.nodes.map((n) => [n.x, n.y]), sim.nodes.map((n) => [n.x, n.y]));
  assert.ok(again.alpha < 1);
});

test("linked nodes end up closer together than unlinked ones", () => {
  const two: GraphData = {
    nodes: [1, 2, 3, 4, 5, 6].map((i) => node(i)),
    edges: [edge(1, 2, 0.9), edge(2, 3, 0.9), edge(1, 3, 0.9), edge(4, 5, 0.9), edge(5, 6, 0.9), edge(4, 6, 0.9)],
  };
  const sim = createSim(buildView(two, base));
  for (let i = 0; i < 600; i++) stepSim(sim);
  const dist = (a: number, b: number) => {
    const p = sim.nodes[sim.index.get(a)!];
    const q = sim.nodes[sim.index.get(b)!];
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  const intra = [dist(1, 2), dist(2, 3), dist(1, 3), dist(4, 5), dist(5, 6), dist(4, 6)];
  const inter = [dist(1, 4), dist(2, 5), dist(3, 6), dist(1, 5), dist(2, 6), dist(3, 4)];
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(avg(intra) < avg(inter), `intra ${avg(intra)} vs inter ${avg(inter)}`);
  assert.ok(isSettled(sim) || sim.alpha < 0.1);
});

test("fixed nodes do not move; hit test picks the nearest node", () => {
  const sim = createSim(buildView(data, base));
  sim.nodes[0].fixed = true;
  const { x, y } = sim.nodes[0];
  for (let i = 0; i < 50; i++) stepSim(sim);
  assert.deepEqual([sim.nodes[0].x, sim.nodes[0].y], [x, y]);
  assert.equal(hitTest(sim, x + 1, y + 1)?.id, sim.nodes[0].id);
  assert.equal(hitTest(sim, 99999, 99999), null);
});

// ---------------------------------------------------------------- thư mục, thẻ, loại cạnh, tìm kiếm

const fdata: GraphData = {
  nodes: [
    { ...node(1), folder_id: 10, title: "Học máy cơ bản" },
    { ...node(2), folder_id: 10, title: "RAG" },
    { ...node(3), folder_id: 20, title: "Embedding" },
    { ...node(4), folder_id: null, title: "Nhật ký" },
  ],
  edges: [edge(1, 2, 0.9), edge(2, 3, 0.8, true), edge(3, 4, null, true)],
};

test("ẩn thư mục: bỏ ghi chú trong thư mục đó và các cạnh nối tới chúng", () => {
  const v = buildView(fdata, { ...base, hiddenFolders: new Set(["20"]) });
  assert.deepEqual(v.nodes.map((n) => n.id), [1, 2]);
  assert.deepEqual(v.edges.map((e) => [e.source, e.target]), [[1, 2]]);
  const none = buildView(fdata, { ...base, hiddenFolders: new Set(["none"]), showOrphans: true });
  assert.ok(!none.nodes.some((n) => n.id === 4));
});

test("lọc theo thẻ", () => {
  const tags: Record<number, string[]> = { 1: ["ai"], 2: ["ai"], 3: [], 4: ["ai"] };
  const v = buildView(fdata, { ...base, tag: "ai", tagsOf: (id) => tags[id], showOrphans: true });
  assert.deepEqual(v.nodes.map((n) => n.id), [1, 2, 4]);
});

test("tắt từng loại cạnh: [[wiki]] hoặc ngữ nghĩa", () => {
  const noSem = buildView(fdata, { ...base, showSemantic: false });
  assert.deepEqual(noSem.edges.map((e) => [e.source, e.target]), [[2, 3], [3, 4]]);
  assert.ok(noSem.edges.every((e) => e.semantic_score === null));
  const noWiki = buildView(fdata, { ...base, showWiki: false });
  assert.deepEqual(noWiki.edges.map((e) => [e.source, e.target, e.wiki]), [[1, 2, false], [2, 3, false]]);
  assert.ok(!noWiki.nodes.some((n) => n.id === 4)); // chỉ nối bằng wiki → thành mồ côi
});

test("màu thư mục ổn định theo id, không thư mục có màu riêng", () => {
  const c = folderColors([{ id: 20 }, { id: 10 }]);
  assert.equal(c.get(folderKey(10)), FOLDER_PALETTE[0]);
  assert.equal(c.get(folderKey(20)), FOLDER_PALETTE[1]);
  assert.equal(c.get(folderKey(null)), NO_FOLDER_COLOR);
  const many = folderColors(Array.from({ length: 14 }, (_, i) => ({ id: i + 1 })));
  assert.equal(new Set(many.values()).size, 15);
});

test("tìm trên graph: không dấu, theo tiêu đề hoặc cả nội dung", () => {
  assert.deepEqual([...matchNodes(fdata.nodes, "hoc may", "title")], [1]);
  const content: Record<number, string> = { 1: "", 2: "", 3: "vector FAISS", 4: "" };
  assert.deepEqual([...matchNodes(fdata.nodes, "faiss", "title", (id) => content[id])], []);
  assert.deepEqual([...matchNodes(fdata.nodes, "faiss", "content", (id) => content[id])], [3]);
  assert.equal(matchNodes(fdata.nodes, "   ", "title").size, 0);
});

test("khung bao của các nút khớp", () => {
  const sim = createSim(buildView(fdata, base));
  const b = boundsOf(sim, [1, 2])!;
  const [p, q] = [sim.nodes[sim.index.get(1)!], sim.nodes[sim.index.get(2)!]];
  assert.equal(b.x0, Math.min(p.x, q.x));
  assert.equal(boundsOf(sim, [999]), null);
});

test("mật độ liên kết: ngưỡng theo phân vị điểm của chính kho ghi chú", () => {
  const sem = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((s, i) => edge(i, i + 1, s));
  const c = densityCutoffs([...sem, edge(20, 21, null, true)]); // cạnh wiki không tính vào phân bố
  const kept = (t: number) => sem.filter((e) => (e.semantic_score ?? 0) >= t).length;
  assert.equal(kept(c.few), 2); // ~25% mạnh nhất
  assert.equal(kept(c.mid), 4); // ~50% mạnh nhất
  assert.equal(kept(c.many), 8);
  assert.deepEqual(densityCutoffs([edge(1, 2, 0.9)]), { few: 0, mid: 0, many: 0 });
  assert.equal(quantile([3, 1, 2], 0.5), 2);
});

test("gợi ý đã ✓ luôn hiện bất kể ngưỡng, nhưng ẩn khi tắt loại Gợi ý AI", () => {
  const d: GraphData = { nodes: [node(1), node(2), node(3)], edges: [{ ...edge(1, 2, 0.5), accepted: true }, edge(2, 3, 0.5)] };
  assert.deepEqual(buildView(d, { ...base, minScore: 0.9 }).edges.map((e) => [e.source, e.target]), [[1, 2]]);
  assert.equal(buildView(d, { ...base, minScore: 0.9, showSemantic: false }).edges.length, 0);
});
