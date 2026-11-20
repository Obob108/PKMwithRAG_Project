// Mô hình graph view (thuần, không phụ thuộc React/canvas): lọc, màu thư mục, tìm kiếm, tập lân cận, mô phỏng lực.
import { fold } from "./text.ts";

export interface GNode {
  id: number;
  title: string;
  source: string; // "md" | "pdf"
  has_file: boolean;
  degree: number;
  folder_id?: number | null;
  folder_name?: string | null;
}
export interface GEdge {
  source: number;
  target: number;
  semantic_score: number | null;
  wiki: boolean;
  accepted?: boolean; // gợi ý ngữ nghĩa đã được người dùng chấp nhận (luôn hiện, như wiki-link)
}
export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
  folders?: { id: number; name: string }[];
}
export interface ViewOptions {
  minScore: number; // ngưỡng cosine cho cạnh ngữ nghĩa (cạnh wiki và cạnh đã chấp nhận luôn hiện)
  showOrphans: boolean; // ghi chú không liên kết với ai
  focusId: number | null; // != null: chỉ hiện lân cận của ghi chú này (graph cục bộ)
  depth: number;
  hiddenFolders?: Set<string>; // khóa từ folderKey(); ẩn ghi chú thuộc các thư mục này
  tag?: string | null; // chỉ giữ ghi chú có thẻ này
  tagsOf?: (id: number) => string[];
  showWiki?: boolean; // mặc định true
  showSemantic?: boolean; // mặc định true
}

/** Khóa nhóm màu/lọc của một thư mục; "none" = không thuộc thư mục nào. */
export function folderKey(folderId: number | null | undefined): string {
  return folderId == null ? "none" : String(folderId);
}

// 12 màu phân biệt rõ, đọc được trên cả nền sáng và tối. Thư mục thứ 13 trở đi quay vòng (đổi độ sáng).
export const FOLDER_PALETTE = [
  "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#edc948",
  "#76b7b2", "#ff9da7", "#9c755f", "#86bcb6", "#d37295", "#a0cbe8",
];
export const NO_FOLDER_COLOR = "#9a9aa2";

/** Gán màu cố định theo thứ tự id thư mục (ổn định khi thêm thư mục mới). */
export function folderColors(folders: { id: number }[]): Map<string, string> {
  const m = new Map<string, string>([["none", NO_FOLDER_COLOR]]);
  [...folders].sort((a, b) => a.id - b.id).forEach((f, i) => {
    const base = FOLDER_PALETTE[i % FOLDER_PALETTE.length];
    m.set(folderKey(f.id), i < FOLDER_PALETTE.length ? base : shade(base, i % 2 ? -0.25 : 0.25));
  });
  return m;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export type SearchMode = "title" | "content" | "semantic";

/** Tìm cục bộ trên graph: mọi từ khóa (không dấu, không phân biệt hoa thường) phải có trong tiêu đề (hoặc nội dung). */
export function matchNodes(nodes: GNode[], query: string, mode: "title" | "content", contentOf?: (id: number) => string): Set<number> {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const out = new Set<number>();
  if (terms.length === 0) return out;
  for (const n of nodes) {
    const hay = fold(n.title) + (mode === "content" && contentOf ? "\n" + fold(contentOf(n.id)) : "");
    if (terms.every((t) => hay.includes(t))) out.add(n.id);
  }
  return out;
}

/** Khung bao (tọa độ mô phỏng) của các nút trong `ids`; null nếu không có nút nào. */
export function boundsOf(sim: Sim, ids: Iterable<number>): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const i = sim.index.get(id);
    if (i === undefined) continue;
    const n = sim.nodes[i];
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** Áp bộ lọc: chỉ giữ cạnh đủ mạnh, chỉ giữ ghi chú có liên quan (trừ khi bật "mồ côi"), tính lại bậc. */
export function buildView(data: GraphData, o: ViewOptions): GraphData {
  const showWiki = o.showWiki ?? true;
  const showSemantic = o.showSemantic ?? true;
  // Gợi ý AI đã được người dùng ✓ luôn hiện (không phụ thuộc mật độ/ngưỡng), trừ khi tắt hẳn loại "Gợi ý AI".
  const semOk = (e: GEdge) => showSemantic && e.semantic_score !== null && (!!e.accepted || e.semantic_score >= o.minScore);
  let edges = data.edges
    .filter((e) => (showWiki && e.wiki) || semOk(e))
    // cạnh vừa wiki vừa ngữ nghĩa: khi tắt một loại thì chỉ giữ phần còn lại
    .map((e) => (e.wiki && !showWiki ? { ...e, wiki: false } : !semOk(e) && e.semantic_score !== null ? { ...e, semantic_score: null, accepted: false } : e));
  let nodes = data.nodes;
  const hidden = o.hiddenFolders;
  if (hidden && hidden.size) nodes = nodes.filter((n) => !hidden.has(folderKey(n.folder_id)));
  if (o.tag && o.tagsOf) {
    const tag = o.tag;
    const tagsOf = o.tagsOf;
    nodes = nodes.filter((n) => tagsOf(n.id).includes(tag));
  }
  if (nodes !== data.nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }
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

// ---------------------------------------------------------------- mật độ liên kết AI (thay cho ngưỡng cosine thô)
export type Density = "few" | "mid" | "many";
export const DENSITY_LABEL: Record<Density, string> = { few: "Ít", mid: "Vừa", many: "Nhiều" };
export const DENSITY_HINT: Record<Density, string> = {
  few: "Chỉ những ghi chú rất giống nhau về nội dung",
  mid: "Cân bằng giữa đầy đủ và gọn gàng",
  many: "Hiện cả những liên hệ lỏng (có thể rối)",
};

/** Phân vị q (0..1) của một dãy số, nội suy tuyến tính. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = clamp01(q) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Ngưỡng cho từng mức, tính theo phân bố điểm của CHÍNH kho ghi chú này (không dùng số cosine cố định, vì điểm cosine
 * phụ thuộc mô hình embedding và mức đồng chủ đề của kho):
 *   Ít   = 25% liên kết ngữ nghĩa mạnh nhất, Vừa = 50% mạnh nhất, Nhiều = mọi liên kết đã lưu.
 * Mỗi cặp ghi chú tính một lần (cạnh trùng hai chiều đã được máy chủ gộp).
 */
export function densityCutoffs(edges: GEdge[]): Record<Density, number> {
  const scores = edges.map((e) => e.semantic_score).filter((s): s is number => s !== null);
  if (scores.length < 4) return { few: 0, mid: 0, many: 0 }; // quá ít cạnh: hiện hết
  return { few: quantile(scores, 0.75), mid: quantile(scores, 0.5), many: 0 };
}
