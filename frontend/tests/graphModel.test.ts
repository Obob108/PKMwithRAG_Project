import test from "node:test";
import assert from "node:assert/strict";
import { buildView, createSim, highlightSet, hitTest, isSettled, neighborSet, stepSim } from "../src/lib/graphModel.ts";
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
