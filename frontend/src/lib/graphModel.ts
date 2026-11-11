// Mô hình graph view (thuần, không phụ thuộc React/canvas): lọc, tập lân cận, mô phỏng lực.

export interface GNode {
  id: number;
  title: string;
  source: string; // "md" | "pdf"
  has_file: boolean;
  degree: number;
}
export interface GEdge {
  source: number;
  target: number;
  semantic_score: number | null;
  wiki: boolean;
}
export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
}
export interface ViewOptions {
  minScore: number; // ngưỡng cosine cho cạnh ngữ nghĩa (cạnh wiki luôn hiện)
  showOrphans: boolean; // ghi chú không liên kết với ai
  focusId: number | null; // != null: chỉ hiện lân cận của ghi chú này (graph cục bộ)
  depth: number;
}

/** Áp bộ lọc: chỉ giữ cạnh đủ mạnh, chỉ giữ ghi chú có liên quan (trừ khi bật "mồ côi"), tính lại bậc. */
export function buildView(data: GraphData, o: ViewOptions): GraphData {
  let edges = data.edges.filter((e) => e.wiki || (e.semantic_score ?? 0) >= o.minScore);
  let nodes = data.nodes;
  if (o.focusId !== null && nodes.some((n) => n.id === o.focusId)) {
    const keep = new Set<number>([o.focusId]);
    for (let d = 0; d < o.depth; d++) {
      const frontier = new Set(keep); // chụp lại để mỗi lượt chỉ mở rộng đúng một bước
      for (const e of edges) {
        if (frontier.has(e.source)) keep.add(e.target);
        if (frontier.has(e.target)) keep.add(e.source);
      }
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const out = nodes
    .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
    .filter((n) => o.showOrphans || n.degree > 0 || n.id === o.focusId);
  const keepIds = new Set(out.map((n) => n.id));
  return { nodes: out, edges: edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)) };
}

/** Các ghi chú nối trực tiếp với `id`. */
export function neighborSet(edges: GEdge[], id: number): Set<number> {
  const s = new Set<number>();
  for (const e of edges) {
    if (e.source === id) s.add(e.target);
    else if (e.target === id) s.add(e.source);
  }
  return s;
}

/** Tập nút sáng khi chọn một nút: chính nó + lân cận; null = không chọn gì (hiện đều). */
export function highlightSet(edges: GEdge[], selectedId: number | null): Set<number> | null {
  if (selectedId === null) return null;
  const s = neighborSet(edges, selectedId);
  s.add(selectedId);
  return s;
}

// ---------------------------------------------------------------- mô phỏng lực
export interface SimNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  r: number;
  deg: number;
}
export interface SimLink {
  a: number; // chỉ số trong nodes
  b: number;
  w: number; // 0..1, cạnh càng mạnh càng ngắn
}
export interface Sim {
  nodes: SimNode[];
  links: SimLink[];
  index: Map<number, number>;
  alpha: number;
}

export function nodeRadius(deg: number): number {
  return Math.min(14, 4 + Math.sqrt(deg) * 2.2);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createSim(view: GraphData, prev?: Map<number, { x: number; y: number }>): Sim {
  const rand = rng(12345);
  const spread = 60 + Math.sqrt(view.nodes.length) * 28;
  const nodes: SimNode[] = view.nodes.map((n) => {
    const p = prev?.get(n.id);
    const angle = rand() * Math.PI * 2;
    return {
      id: n.id,
      x: p ? p.x : Math.cos(angle) * spread * (0.4 + rand() * 0.6),
      y: p ? p.y : Math.sin(angle) * spread * (0.4 + rand() * 0.6),
      vx: 0, vy: 0, fixed: false, r: nodeRadius(n.degree), deg: n.degree,
    };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links: SimLink[] = [];
  for (const e of view.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined) links.push({ a, b, w: e.wiki ? 1 : Math.min(1, Math.max(0, e.semantic_score ?? 0.5)) });
  }
  return { nodes, links, index, alpha: prev && prev.size ? 0.35 : 1 };
}

export function stepSim(sim: Sim): void {
  const { nodes, links } = sim;
  const a = sim.alpha;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let dx = nodes[j].x - nodes[i].x;
      let dy = nodes[j].y - nodes[i].y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 360000) continue; // xa hơn 600px: bỏ qua
      if (d2 < 1) {
        dx = (i % 2 ? 1 : -1) * 0.5;
        dy = (j % 2 ? 1 : -1) * 0.5;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const f = (2600 * a) / d2;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      nodes[i].vx -= fx;
      nodes[i].vy -= fy;
      nodes[j].vx += fx;
      nodes[j].vy += fy;
    }
  }
  for (const l of links) {
    const p = nodes[l.a];
    const q = nodes[l.b];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = 50 + (1 - l.w) * 90;
    const f = (d - rest) * 0.04 * a * (0.5 + l.w);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    p.vx += fx;
    p.vy += fy;
    q.vx -= fx;
    q.vy -= fy;
  }
  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx -= n.x * 0.012 * a; // hút nhẹ về tâm
    n.vy -= n.y * 0.012 * a;
    n.vx *= 0.82;
    n.vy *= 0.82;
    n.x += n.vx;
    n.y += n.vy;
  }
  sim.alpha = Math.max(0.015, sim.alpha * 0.985);
}

export function isSettled(sim: Sim): boolean {
  return sim.alpha <= 0.0151;
}

/** Nút gần điểm (x, y) nhất trong bán kính chạm, hoặc null. */
export function hitTest(sim: Sim, x: number, y: number, slack = 4): SimNode | null {
  let best: SimNode | null = null;
  let bestD = Infinity;
  for (const n of sim.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= n.r + slack && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
