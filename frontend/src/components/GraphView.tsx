import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons.tsx";
import type { KeyboardEvent } from "react";
import type { HttpApi } from "../lib/api.ts";
import {
  boundsOf, buildView, createSim, DENSITY_HINT, DENSITY_LABEL, densityCutoffs, folderColors, folderKey, hitTest,
  highlightSet, isSettled, matchNodes, NO_FOLDER_COLOR, placeLabels, stepSim,
} from "../lib/graphModel.ts";
import type { Density, GEdge, GNode, GraphData, SearchMode, Sim, SimNode } from "../lib/graphModel.ts";
import { extractTags } from "../lib/text.ts";
import type { Folder, LocalNote } from "../lib/types.ts";

interface Props {
  api: HttpApi;
  activeNoteId: number | null;
  /** Đổi giá trị này khi ghi chú/liên kết có thể đã đổi để tải lại graph. */
  refreshKey: string;
  visible: boolean;
  /** Ghi chú cục bộ: lấy thư mục mới nhất, thẻ (#tag) và nội dung để tìm/xem trước mà không cần gọi máy chủ. */
  notes: LocalNote[];
  folders: Folder[];
  online: boolean;
  onOpenNote: (id: number) => void;
  onOpenPdf: (id: number) => void;
  onMoveNote: (id: number, folderId: number | null) => void;
}

interface Colors {
  bg: string; fg: string; muted: string; accent: string; edge: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return { bg: v("--bg", "#1e1e1e"), fg: v("--fg", "#dcddde"), muted: v("--muted", "#999"), accent: v("--accent", "#1b7fa6"), edge: v("--edge", "#888") };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const DENSITY_KEY = "pkm.graph.density";
function loadDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return v === "few" || v === "mid" || v === "many" ? v : "mid";
  } catch {
    return "mid";
  }
}

const MODE_LABEL: Record<SearchMode, string> = { title: "Tiêu đề", content: "Tiêu đề + nội dung", semantic: "Ngữ nghĩa (AI)" };

/** Đoạn xem trước: bỏ bớt ký hiệu markdown cho dễ đọc. */
function preview(md: string, max = 260): string {
  const t = md
    .replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "") // frontmatter YAML
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export default function GraphView(p: Props) {
  const { api, activeNoteId, refreshKey, visible, notes, online, onOpenNote, onOpenPdf, onMoveNote } = p;
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // bộ lọc
  // Người dùng chọn mật độ (Ít/Vừa/Nhiều); ngưỡng cosine thô chỉ chỉnh được trong mục "Nâng cao".
  const [density, setDensityState] = useState<Density>(loadDensity);
  const setDensity = (d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* bỏ qua */ }
  };
  const [advanced, setAdvanced] = useState(false);
  const [customScore, setCustomScore] = useState(0.75);
  const [showWiki, setShowWiki] = useState(true);
  const [showSemantic, setShowSemantic] = useState(true);
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);
  const [labels, setLabels] = useState(true);
  // graph cục bộ
  const [depth, setDepth] = useState(1);
  const [focusId, setFocusId] = useState<number | null>(null);
  // tìm kiếm
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("title");
  const [semHits, setSemHits] = useState<Map<number, number> | null>(null);
  const [semState, setSemState] = useState<"idle" | "loading" | "error">("idle");
  const [cursor, setCursor] = useState(0);
  // chọn / bảng
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 799px)").matches;
  const [panelOpen, setPanelOpen] = useState(!narrow); // điện thoại: thu gọn sẵn để không che graph
  const [legendOpen, setLegendOpen] = useState(!narrow);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const tf = useRef({ x: 0, y: 0, k: 1 });
  const tfTarget = useRef<{ x: number; y: number; k: number } | null>(null); // camera bay tới (hoạt ảnh)
  const zoomReq = useRef<number[] | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef(true);
  const fitRequest = useRef<"instant" | "smooth" | null>(null);
  const dragging = useRef(false);
  const hoverId = useRef<number | null>(null);
  const alphas = useRef(new Map<number, number>());
  const scales = useRef(new Map<number, number>());
  const colors = useRef<Colors>(readColors());
  const propsRef = useRef({ onOpenNote });
  propsRef.current = { onOpenNote };

  const load = useCallback(() => {
    setLoading(true);
    api.graph(0)
      .then((d) => { setData(d); setError(null); })
      .catch(() => setError("Không tải được graph (cần kết nối máy chủ)."))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(load, 600);
    return () => clearTimeout(t);
  }, [visible, refreshKey, load]);

  // ---------------------------------------------------------------- dữ liệu ghép (máy chủ + cục bộ)
  const localById = useMemo(() => {
    const m = new Map<number, LocalNote>();
    for (const n of notes) if (n.id !== null) m.set(n.id, n);
    return m;
  }, [notes]);
  const tagsById = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const [id, n] of localById) m.set(id, extractTags(n.content));
    return m;
  }, [localById]);
  // Thư mục lấy theo bản cục bộ (đổi thư mục thấy ngay, không chờ tải lại graph).
  const merged = useMemo<GraphData | null>(() => {
    if (!data) return null;
    return {
      ...data,
      nodes: data.nodes.map((n) => {
        const l = localById.get(n.id);
        return l ? { ...n, folder_id: l.folder_id ?? null, title: l.title || n.title } : n;
      }),
    };
  }, [data, localById]);
  const folderList = useMemo(() => (p.folders.length ? p.folders : data?.folders ?? []), [p.folders, data]);
  const palette = useMemo(() => folderColors(folderList), [folderList]);
  const folderName = useCallback((key: string) => {
    if (key === "none") return "Không thư mục";
    return folderList.find((f) => folderKey(f.id) === key)?.name
      ?? data?.nodes.find((n) => folderKey(n.folder_id) === key)?.folder_name ?? "Thư mục";
  }, [folderList, data]);
  const colorOf = useCallback((n: GNode) => palette.get(folderKey(n.folder_id)) ?? NO_FOLDER_COLOR, [palette]);
  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of data?.nodes ?? []) for (const t of tagsById.get(n.id) ?? []) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data, tagsById]);

  const tagsOf = useCallback((id: number) => tagsById.get(id) ?? [], [tagsById]);
  const cutoffs = useMemo(() => densityCutoffs(data?.edges ?? []), [data]);
  const minScore = advanced ? customScore : cutoffs[density];
  const scoreRange = useMemo(() => {
    const sc = (data?.edges ?? []).map((e) => e.semantic_score).filter((x): x is number => x !== null);
    return sc.length ? { lo: Math.floor(Math.min(...sc) * 100) / 100, hi: Math.ceil(Math.max(...sc) * 100) / 100 } : { lo: 0.5, hi: 1 };
  }, [data]);
  // Số liên kết AI hiện ra ở mỗi mức (với các bộ lọc khác đang bật) để người dùng thấy ngay tác dụng.
  const densityCounts = useMemo(() => {
    const out = { few: 0, mid: 0, many: 0 } as Record<Density, number>;
    if (!merged) return out;
    for (const d of ["few", "mid", "many"] as Density[]) {
      const v = buildView(merged, { minScore: cutoffs[d], showOrphans, focusId, depth, hiddenFolders, tag, tagsOf, showWiki: false, showSemantic: true });
      out[d] = v.edges.length;
    }
    return out;
  }, [merged, cutoffs, showOrphans, focusId, depth, hiddenFolders, tag, tagsOf]);
  const view = useMemo<GraphData>(
    () => (merged
      ? buildView(merged, { minScore, showOrphans, focusId, depth, hiddenFolders, tag, tagsOf, showWiki, showSemantic })
      : { nodes: [], edges: [] }),
    [merged, minScore, showOrphans, focusId, depth, hiddenFolders, tag, tagsOf, showWiki, showSemantic],
  );

  // Số ghi chú mỗi thư mục (trước khi lọc thư mục, để chú thích vẫn hiện thư mục đang ẩn).
  const legendItems = useMemo(() => {
    const count = new Map<string, number>();
    for (const n of merged?.nodes ?? []) count.set(folderKey(n.folder_id), (count.get(folderKey(n.folder_id)) ?? 0) + 1);
    const keys = [...folderList].sort((a, b) => a.name.localeCompare(b.name, "vi")).map((f) => folderKey(f.id));
    for (const k of count.keys()) if (k !== "none" && !keys.includes(k)) keys.push(k);
    if (count.has("none")) keys.push("none");
    return keys.map((k) => ({ key: k, name: folderName(k), color: palette.get(k) ?? NO_FOLDER_COLOR, count: count.get(k) ?? 0 }));
  }, [merged, folderList, folderName, palette]);

  // ---------------------------------------------------------------- tìm kiếm
  const q = search.trim();
  useEffect(() => {
    if (searchMode !== "semantic" || q.length < 2 || !online) {
      setSemHits(null);
      setSemState("idle");
      return;
    }
    let cancelled = false;
    setSemState("loading");
    const t = setTimeout(() => {
      api.search(q, 20)
        .then((hits) => {
          if (cancelled) return;
          const m = new Map<number, number>();
          for (const h of hits) m.set(h.note_id, Math.max(m.get(h.note_id) ?? 0, h.score)); // gộp các đoạn theo ghi chú
          setSemHits(m);
          setSemState("idle");
        })
        .catch(() => { if (!cancelled) setSemState("error"); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, searchMode, online, api]);

  const matchAll = useMemo<Set<number> | null>(() => {
    if (!q || !merged) return null;
    if (searchMode === "semantic") return semHits ? new Set(semHits.keys()) : null;
    return matchNodes(merged.nodes, q, searchMode, (id) => localById.get(id)?.content ?? "");
  }, [q, merged, searchMode, semHits, localById]);
  const visibleIds = useMemo(() => new Set(view.nodes.map((n) => n.id)), [view]);
  const results = useMemo(() => {
    if (!matchAll || !merged) return [];
    const byId = new Map(merged.nodes.map((n) => [n.id, n]));
    const list = [...matchAll].map((id) => byId.get(id)).filter((n): n is GNode => !!n);
    if (searchMode === "semantic" && semHits) list.sort((a, b) => (semHits.get(b.id) ?? 0) - (semHits.get(a.id) ?? 0));
    else list.sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, "vi"));
    return list;
  }, [matchAll, merged, searchMode, semHits]);
  const shownResults = results.filter((n) => visibleIds.has(n.id));
  const hiddenCount = results.length - shownResults.length;
  const matchVisible = useMemo(() => (matchAll ? new Set([...matchAll].filter((id) => visibleIds.has(id))) : null), [matchAll, visibleIds]);
  const matchKey = matchVisible ? [...matchVisible].sort((a, b) => a - b).join(",") : "";

  // Kết quả đổi: camera bay tới vùng chứa các ghi chú khớp.
  useEffect(() => {
    setCursor(0);
    if (matchKey) zoomReq.current = matchKey.split(",").map(Number);
    dirty.current = true;
  }, [matchKey]);

  const selected = view.nodes.find((n) => n.id === selectedId) ?? null;
  const neighborInfo = useMemo(() => {
    if (!selected) return [];
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    const out: { node: GNode; edge: GEdge }[] = [];
    for (const e of view.edges) {
      const other = e.source === selected.id ? e.target : e.target === selected.id ? e.source : null;
      const n = other !== null ? byId.get(other) : undefined;
      if (n) out.push({ node: n, edge: e });
    }
    out.sort((a, b) => Number(b.edge.wiki) - Number(a.edge.wiki) || Number(!!b.edge.accepted) - Number(!!a.edge.accepted)
      || (b.edge.semantic_score ?? 0) - (a.edge.semantic_score ?? 0));
    return out;
  }, [selected, view]);

  // Trạng thái mới nhất cho vòng vẽ (tránh dựng lại vòng lặp mỗi lần đổi).
  const live = useRef({ view, selectedId: selected ? selected.id : null, matches: matchVisible, labels, colorOf });
  live.current = { view, selectedId: selected ? selected.id : null, matches: matchVisible, labels, colorOf };

  // Dựng mô phỏng mới khi dữ liệu hiển thị đổi, giữ vị trí cũ để graph không "nhảy".
  useEffect(() => {
    const prev = simRef.current ? new Map(simRef.current.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : undefined;
    const sim = createSim(view, prev);
    if (!prev || prev.size === 0) {
      for (let i = 0; i < 150; i++) stepSim(sim);
      sim.alpha = 0.3;
      fitRequest.current = "instant";
    }
    simRef.current = sim;
    dirty.current = true;
  }, [view]);

  useEffect(() => {
    dirty.current = true;
  }, [selectedId, labels, palette]);

  /** Tính khung nhìn bao các nút `ids` (mọi nút nếu không truyền). */
  const frameFor = useCallback((ids?: Iterable<number>, maxK = 2) => {
    const sim = simRef.current;
    const { w, h } = size.current;
    if (!sim || sim.nodes.length === 0 || w === 0) return null;
    const b = boundsOf(sim, ids ?? sim.nodes.map((n) => n.id));
    if (!b) return null;
    const k = clamp(Math.min(w / (b.x1 - b.x0 + 160), h / (b.y1 - b.y0 + 160)), 0.25, maxK);
    return { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: h / 2 - ((b.y0 + b.y1) / 2) * k };
  }, []);

  const flyTo = useCallback((ids: number[], maxK = 1.6) => {
    const f = frameFor(ids, maxK);
    if (f) tfTarget.current = f;
    dirty.current = true;
  }, [frameFor]);

  // Kích thước canvas + đổi giao diện sáng/tối.
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.max(1, Math.floor(r.width * dpr));
      cv.height = Math.max(1, Math.floor(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      dirty.current = true;
    });
    ro.observe(el);
    const mo = new MutationObserver(() => {
      colors.current = readColors();
      dirty.current = true;
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // ---------------------------------------------------------------- vòng mô phỏng + vẽ
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    colors.current = readColors();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const sim = simRef.current;
      const cv = canvasRef.current;
      const { w, h, dpr } = size.current;
      if (!sim || !cv || w === 0) return;
      if (fitRequest.current) {
        const f = frameFor();
        if (f) {
          if (fitRequest.current === "instant") tf.current = f;
          else tfTarget.current = f;
        }
        fitRequest.current = null;
        dirty.current = true;
      }
      if (zoomReq.current) {
        flyTo(zoomReq.current);
        zoomReq.current = null;
      }
      let moving = false;
      if (!isSettled(sim) || dragging.current) {
        stepSim(sim);
        stepSim(sim);
        moving = true;
      }
      if (tfTarget.current) {
        const t = tf.current, g = tfTarget.current;
        const nt = { x: t.x + (g.x - t.x) * 0.18, y: t.y + (g.y - t.y) * 0.18, k: t.k + (g.k - t.k) * 0.18 };
        if (Math.abs(nt.x - g.x) < 0.5 && Math.abs(nt.y - g.y) < 0.5 && Math.abs(nt.k - g.k) < 0.002) {
          tf.current = g;
          tfTarget.current = null;
        } else tf.current = nt;
        moving = true;
      }
      const { view: v, selectedId: sel, matches, labels: showLabels, colorOf: colorFn } = live.current;
      const focus = hoverId.current ?? sel; // rê chuột ưu tiên hơn nút đang chọn
      const hl = highlightSet(v.edges, focus);
      let animating = false;
      for (const n of v.nodes) {
        const isMatch = matches?.has(n.id) ?? false;
        const ta = hl ? (hl.has(n.id) ? 1 : 0.12) : matches ? (isMatch ? 1 : 0.13) : 1;
        const ts = matches && isMatch ? 1.6 : n.id === hoverId.current ? 1.25 : 1;
        for (const [store, target] of [[alphas.current, ta], [scales.current, ts]] as const) {
          const cur = store.get(n.id) ?? target;
          const next = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * 0.25;
          if (next !== target) animating = true;
          store.set(n.id, next);
        }
      }
      if (!moving && !animating && !dirty.current) return;
      dirty.current = false;

      const c = cv.getContext("2d");
      if (!c) return;
      const { x: tx, y: ty, k } = tf.current;
      const col = colors.current;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = col.bg;
      c.fillRect(0, 0, w, h);
      const alphaOf = (id: number) => alphas.current.get(id) ?? 1;

      const info = new Map(v.nodes.map((n) => [n.id, n]));
      // Cạnh: [[liên kết]] = nét liền, đậm; ngữ nghĩa = nét đứt, độ đậm theo độ tương đồng.
      for (const e of v.edges) {
        const a = sim.nodes[sim.index.get(e.source) ?? -1];
        const b = sim.nodes[sim.index.get(e.target) ?? -1];
        if (!a || !b) continue;
        const touches = focus !== null && (e.source === focus || e.target === focus);
        const sem = clamp(e.semantic_score ?? 0.5, 0, 1);
        const strong = e.wiki || !!e.accepted; // do người dùng viết [[…]] hoặc đã ✓ gợi ý
        // gợi ý AI nối hai thư mục khác nhau: mờ hơn khi không chọn nút nào, để các cụm dễ đọc
        const cross = folderKey(info.get(e.source)?.folder_id) !== folderKey(info.get(e.target)?.folder_id);
        const base = touches ? 1 : strong ? 0.75 : (0.3 + 0.45 * sem) * (cross ? 0.45 : 1);
        c.globalAlpha = Math.min(alphaOf(e.source), alphaOf(e.target)) * base;
        c.strokeStyle = touches || strong ? col.accent : col.edge;
        c.lineWidth = (touches ? 2 : strong ? 1.6 : 1) * clamp(k, 0.6, 1.4);
        c.setLineDash(strong ? [] : [5 * clamp(k, 0.6, 1.4), 4 * clamp(k, 0.6, 1.4)]);
        c.beginPath();
        c.moveTo(tx + a.x * k, ty + a.y * k);
        c.lineTo(tx + b.x * k, ty + b.y * k);
        c.stroke();
      }
      c.setLineDash([]);

      // Nút: màu = thư mục; hình tròn = ghi chú, hình vuông bo góc = PDF.
      const labelQ: { text: string; x: number; y: number; al: number; bold: boolean; pri: number }[] = [];
      for (const n of sim.nodes) {
        const meta = info.get(n.id);
        if (!meta) continue;
        const al = alphaOf(n.id);
        const sc = scales.current.get(n.id) ?? 1;
        const sx = tx + n.x * k;
        const sy = ty + n.y * k;
        const rr = n.r * clamp(k, 0.7, 1.5) * sc;
        const isMatch = matches?.has(n.id) ?? false;
        c.globalAlpha = al;
        c.fillStyle = colorFn(meta);
        if (isMatch) {
          c.shadowColor = colorFn(meta);
          c.shadowBlur = 14;
        }
        c.beginPath();
        if (meta.source === "pdf") c.roundRect(sx - rr, sy - rr, rr * 2, rr * 2, rr * 0.35);
        else c.arc(sx, sy, rr, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
        if (n.id === sel || n.id === hoverId.current || isMatch) {
          c.strokeStyle = n.id === sel ? col.accent : col.fg;
          c.lineWidth = n.id === sel ? 3 : isMatch ? 2 : 1.5;
          c.stroke();
        }
        const showLabel = (showLabels && (k > 0.9 || (hl?.has(n.id) ?? false) || meta.degree >= 4)) || n.id === hoverId.current || isMatch;
        if (showLabel && al > 0.3) {
          const t = meta.title.length > 28 ? meta.title.slice(0, 27) + "…" : meta.title;
          // ưu tiên: đang rê/chọn > khớp tìm kiếm > lân cận nút đang chọn > nút nhiều liên kết
          const pri = n.id === hoverId.current || n.id === sel ? 3 : isMatch ? 2 : hl?.has(n.id) ? 1 : 0;
          labelQ.push({ text: t, x: sx, y: sy + rr + 13, al, bold: isMatch, pri: pri * 1000 + meta.degree });
        }
      }
      // Nhãn vẽ sau mọi nút (không bị nút đè) và bỏ nhãn chồng lên nhãn đã vẽ; nhãn ưu tiên cao luôn hiện.
      labelQ.sort((p, q) => q.pri - p.pri);
      c.textAlign = "center";
      const fontOf = (bold: boolean) => `${bold ? "600 12px" : "11px"} "Segoe UI", Roboto, system-ui, sans-serif`;
      const boxes = labelQ.map((l) => {
        c.font = fontOf(l.bold);
        const half = c.measureText(l.text).width / 2 + 3;
        return [l.x - half, l.y - 11, l.x + half, l.y + 4] as [number, number, number, number];
      });
      for (const i of placeLabels(boxes, labelQ.map((l) => l.pri >= 3000))) {
        const l = labelQ[i];
        c.globalAlpha = l.al;
        c.font = fontOf(l.bold);
        // viền nền mỏng quanh chữ để đọc được cả khi đè lên cạnh
        c.lineWidth = 3;
        c.strokeStyle = col.bg;
        c.strokeText(l.text, l.x, l.y);
        c.fillStyle = col.fg;
        c.fillText(l.text, l.x, l.y);
      }
      c.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [visible, frameFor, flyTo]);

  // ---------------------------------------------------------------- tương tác: kéo nút, kéo nền, thu phóng, chạm, rê chuột
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { kind: "none" | "pan" | "node" | "pinch"; node: SimNode | null; sx: number; sy: number; lx: number; ly: number; moved: boolean; dist: number } =
      { kind: "none", node: null, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, dist: 0 };
    let lastTap = { id: -1, t: 0 };

    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const world = (x: number, y: number) => ({ x: (x - tf.current.x) / tf.current.k, y: (y - tf.current.y) / tf.current.k });
    const zoomAt = (px: number, py: number, factor: number) => {
      tfTarget.current = null; // người dùng tự điều khiển: dừng hoạt ảnh camera
      const t = tf.current;
      const k = clamp(t.k * factor, 0.15, 4);
      tf.current = { k, x: px - (px - t.x) * (k / t.k), y: py - (py - t.y) * (k / t.k) };
      dirty.current = true;
    };
    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const setHover = (id: number | null) => {
      if (id !== hoverId.current) {
        hoverId.current = id;
        cv.style.cursor = id !== null ? "pointer" : "grab";
        dirty.current = true;
      }
    };

    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      tfTarget.current = null;
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 2) {
        gesture = { ...gesture, kind: "pinch", dist: pinchDist(), moved: true };
        return;
      }
      const w = world(pt.x, pt.y);
      const sim = simRef.current;
      const hit = sim ? hitTest(sim, w.x, w.y, 6 / tf.current.k) : null;
      gesture = { kind: hit ? "node" : "pan", node: hit, sx: pt.x, sy: pt.y, lx: pt.x, ly: pt.y, moved: false, dist: 0 };
    };

    const move = (e: PointerEvent) => {
      const pt = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
      if (gesture.kind === "pinch" && pointers.size >= 2) {
        const d = pinchDist();
        const [a, b] = [...pointers.values()];
        if (gesture.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesture.dist);
        gesture.dist = d;
        return;
      }
      if (gesture.kind === "node" && gesture.node) {
        if (!gesture.moved && Math.hypot(pt.x - gesture.sx, pt.y - gesture.sy) > 4) gesture.moved = true;
        if (gesture.moved) {
          const w = world(pt.x, pt.y);
          gesture.node.fixed = true;
          gesture.node.x = w.x;
          gesture.node.y = w.y;
          dragging.current = true;
          if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.3);
        }
        return;
      }
      if (gesture.kind === "pan") {
        if (!gesture.moved && Math.hypot(pt.x - gesture.sx, pt.y - gesture.sy) > 4) gesture.moved = true;
        if (gesture.moved) {
          tf.current = { ...tf.current, x: tf.current.x + (pt.x - gesture.lx), y: tf.current.y + (pt.y - gesture.ly) };
          dirty.current = true;
        }
        gesture.lx = pt.x;
        gesture.ly = pt.y;
        return;
      }
      // rê chuột (không nhấn): làm nổi bật nút đang trỏ và các nút láng giềng
      if (e.pointerType === "touch") return;
      const w = world(pt.x, pt.y);
      const hit = simRef.current ? hitTest(simRef.current, w.x, w.y, 6 / tf.current.k) : null;
      setHover(hit ? hit.id : null);
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (gesture.kind === "pinch") {
        if (pointers.size < 2) gesture = { ...gesture, kind: "none", node: null };
        return;
      }
      if (gesture.kind === "node" && gesture.node) {
        const n = gesture.node;
        if (!gesture.moved) {
          const now = performance.now();
          if (lastTap.id === n.id && now - lastTap.t < 350) {
            propsRef.current.onOpenNote(n.id); // chạm / bấm đôi: mở ghi chú
            lastTap = { id: -1, t: 0 };
          } else {
            lastTap = { id: n.id, t: now };
            setSelectedId(n.id); // bấm một lần: mở bảng xem trước
          }
        }
        n.fixed = false;
        dragging.current = false;
      } else if (gesture.kind === "pan" && !gesture.moved) {
        setSelectedId(null);
      }
      gesture = { ...gesture, kind: "none", node: null };
    };

    const leave = () => setHover(null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };

    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
    };
  }, []);

  // ---------------------------------------------------------------- thao tác giao diện
  const goTo = (id: number) => {
    setSelectedId(id);
    flyTo([id], 1.6);
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setSearch("");
    if (e.key === "Enter" && shownResults.length) {
      e.preventDefault();
      const i = cursor % shownResults.length;
      goTo(shownResults[i].id); // Enter: lần lượt nhảy tới từng kết quả
      setCursor(i + 1);
    }
  };
  const toggleFolder = (key: string) => setHiddenFolders((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const soloFolder = (key: string) => setHiddenFolders(() => {
    const all = legendItems.map((x) => x.key).filter((k) => k !== key);
    return hiddenFolders.size === all.length && !hiddenFolders.has(key) ? new Set() : new Set(all);
  });

  const focusTitle = focusId !== null ? merged?.nodes.find((n) => n.id === focusId)?.title : null;
  const selLocal = selected ? localById.get(selected.id) : undefined;
  const selFolderKey = selected ? folderKey(selected.folder_id) : "none";
  const filtersActive = hiddenFolders.size > 0 || tag !== null || !showWiki || !showSemantic || focusId !== null;

  return (
    <div className="graph-pane" ref={wrapRef}>
      <canvas ref={canvasRef} className="graph-canvas" />

      {view.nodes.length === 0 && !loading && (
        <div className="graph-empty">
          {error ?? (filtersActive
            ? "Không có ghi chú nào khớp bộ lọc hiện tại. Bỏ bớt bộ lọc ở bảng điều khiển hoặc chú thích thư mục."
            : "Chưa có liên kết nào để hiển thị. Thêm ghi chú liên quan, dùng [[liên kết]], hạ ngưỡng ở bảng điều khiển, hoặc bật “Hiện ghi chú mồ côi”.")}
        </div>
      )}

      {/* ---------------- bảng điều khiển: tìm kiếm + bộ lọc + graph cục bộ */}
      <div className={"graph-controls" + (panelOpen ? "" : " collapsed")}>
        <button className="graph-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-label="Bảng điều khiển graph">
          {panelOpen ? "▾ Tìm kiếm & bộ lọc" : "▸ Tìm kiếm & bộ lọc"}
        </button>
        {panelOpen && (
          <>
            <div className="graph-section">
              <div className="graph-search">
                <input className="search-input" placeholder="Tìm trên graph…" value={search}
                       onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} />
                {search && <button className="icon" aria-label="Xóa tìm kiếm" onClick={() => setSearch("")}>×</button>}
              </div>
              <div className="seg small" role="group" aria-label="Kiểu tìm">
                {(["title", "content", "semantic"] as SearchMode[]).map((m) => (
                  <button key={m} className={searchMode === m ? "active" : ""} disabled={m === "semantic" && !online}
                          title={m === "semantic" && !online ? "Cần kết nối máy chủ" : MODE_LABEL[m]}
                          onClick={() => setSearchMode(m)}>
                    {m === "title" ? "Tiêu đề" : m === "content" ? "Nội dung" : "Ngữ nghĩa"}
                  </button>
                ))}
              </div>
              {q && (
                <div className="graph-results">
                  <div className="muted small">
                    {searchMode === "semantic" && semState === "loading" ? "Đang tìm theo ngữ nghĩa…"
                      : searchMode === "semantic" && semState === "error" ? "Không tìm được (cần kết nối máy chủ)."
                      : searchMode === "semantic" && q.length < 2 ? "Gõ ít nhất 2 ký tự."
                      : `${shownResults.length} ghi chú khớp${hiddenCount ? ` · ${hiddenCount} bị ẩn bởi bộ lọc` : ""}${shownResults.length > 1 ? " · Enter để nhảy lần lượt" : ""}`}
                  </div>
                  <ul className="neighbor-list">
                    {shownResults.slice(0, 8).map((n) => (
                      <li key={n.id}>
                        <button onClick={() => goTo(n.id)} className={n.id === selectedId ? "active" : ""}>
                          <span className="dot" style={{ background: colorOf(n) }} /> <span className="nl-title">{n.title}</span>
                          {searchMode === "semantic" && semHits?.has(n.id) && <span className="badge" title="Mức khớp với nội dung tìm kiếm">{Math.round((semHits.get(n.id) ?? 0) * 100)}%</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="graph-section">
              <div className="graph-section-title">Liên kết</div>
              <label className="check"><input type="checkbox" checked={showWiki} onChange={(e) => setShowWiki(e.target.checked)} />
                <svg width="28" height="8" aria-hidden><line x1="1" y1="4" x2="27" y2="4" className="edge-wiki" /></svg> Thủ công [[…]] và gợi ý đã ✓</label>
              <label className="check"><input type="checkbox" checked={showSemantic} onChange={(e) => setShowSemantic(e.target.checked)} />
                <svg width="28" height="8" aria-hidden><line x1="1" y1="4" x2="27" y2="4" className="edge-sem" /></svg> Gợi ý bởi AI (nội dung giống nhau)</label>
              <div className="muted small">Gợi ý đã bỏ qua (✗) không hiện trên graph.</div>
              {showSemantic && !advanced && (
                <div className="density">
                  <div className="muted small">Số liên kết AI muốn xem</div>
                  <div className="seg small density-seg" role="radiogroup" aria-label="Mật độ liên kết AI">
                    {(["few", "mid", "many"] as Density[]).map((d) => (
                      <button key={d} role="radio" aria-checked={density === d} className={density === d ? "active" : ""}
                              title={DENSITY_HINT[d]} onClick={() => setDensity(d)}>
                        {DENSITY_LABEL[d]} <span className="count">{densityCounts[d]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="muted small">{DENSITY_HINT[density]}</div>
                </div>
              )}
              {showSemantic && (
                <details className="advanced" open={advanced}
                         onToggle={(e) => {
                           const open = (e.currentTarget as HTMLDetailsElement).open;
                           if (open && !advanced) setCustomScore(Number(cutoffs[density].toFixed(2)) || scoreRange.lo);
                           setAdvanced(open);
                         }}>
                  <summary className="muted small">Nâng cao</summary>
                  <label className="slider">
                    <span>Độ tương đồng cosine tối thiểu: <b>{customScore.toFixed(2)}</b></span>
                    <input type="range" min={scoreRange.lo} max={scoreRange.hi} step={0.01} value={customScore}
                           onChange={(e) => setCustomScore(Number(e.target.value))} />
                  </label>
                  <div className="muted small">
                    Mốc tự tính: Ít ≥ {cutoffs.few.toFixed(2)} · Vừa ≥ {cutoffs.mid.toFixed(2)} · Nhiều = mọi cạnh đã lưu
                    (≥ {scoreRange.lo.toFixed(2)}). Đóng mục này để quay lại chọn theo mức.
                  </div>
                </details>
              )}
            </div>

            <div className="graph-section">
              <div className="graph-section-title">Lọc ghi chú</div>
              <label className="field small">
                <span>Thẻ</span>
                <select value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)}>
                  <option value="">Tất cả thẻ</option>
                  {allTags.map(([t, c]) => <option key={t} value={t}>#{t} ({c})</option>)}
                </select>
              </label>
              <div className="muted small">Thư mục: bấm vào tên trong bảng “Thư mục” để ẩn/hiện, bấm đôi để chỉ xem thư mục đó.</div>
              <label className="check"><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> Hiện ghi chú mồ côi</label>
              <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Hiện nhãn</label>
            </div>

            <div className="graph-section">
              <div className="graph-section-title">Graph cục bộ</div>
              <label className="check">
                <input type="checkbox" checked={focusId !== null} disabled={activeNoteId === null && focusId === null && selectedId === null}
                       onChange={(e) => setFocusId(e.target.checked ? selectedId ?? activeNoteId : null)} />
                Chỉ lân cận{focusTitle ? `: ${focusTitle}` : selectedId !== null ? " ghi chú đang chọn" : " ghi chú đang mở"}
              </label>
              {focusId !== null && (
                <label className="slider"><span>Độ sâu: <b>{depth}</b> bước</span>
                  <input type="range" min={1} max={3} step={1} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
                </label>
              )}
            </div>

            <div className="graph-buttons">
              <button onClick={() => { fitRequest.current = "smooth"; dirty.current = true; }}>Căn lại</button>
              <button onClick={load} disabled={loading}>{loading ? "Đang tải…" : "Làm mới"}</button>
              {filtersActive && (
                <button onClick={() => { setHiddenFolders(new Set()); setTag(null); setShowWiki(true); setShowSemantic(true); setFocusId(null); setAdvanced(false); }}>Bỏ lọc</button>
              )}
            </div>
            <div className="muted small">{view.nodes.length} ghi chú · {view.edges.length} liên kết</div>
          </>
        )}
      </div>

      {/* ---------------- chú thích màu thư mục (bấm để ẩn/hiện, bấm đôi để chỉ xem thư mục đó) */}
      {legendItems.length > 0 && (
        <div className={"graph-legend" + (legendOpen ? "" : " collapsed")}>
          <button className="graph-toggle" onClick={() => setLegendOpen(!legendOpen)}>{legendOpen ? "▾ Thư mục" : "▸ Thư mục"}</button>
          {legendOpen && (
            <>
              <ul>
                {legendItems.map((it) => (
                  <li key={it.key}>
                    <button className={hiddenFolders.has(it.key) ? "off" : ""} onClick={() => toggleFolder(it.key)}
                            onDoubleClick={() => soloFolder(it.key)}
                            title={hiddenFolders.has(it.key) ? "Bấm để hiện" : "Bấm để ẩn · bấm đôi để chỉ xem thư mục này"}>
                      <span className="dot" style={{ background: it.color }} />
                      <span className="legend-name">{it.name}</span>
                      <span className="badge">{it.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="legend small">
                <span className="shape circle" /> Ghi chú <span className="shape square" /> PDF
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- bảng xem trước ghi chú đang chọn */}
      {selected && (
        <div className="graph-card">
          <div className="graph-card-title"><Icon name={selected.source === "pdf" ? "pdf" : "note"} size={16} /> {selected.title}</div>
          <label className="field small">
            <span className="dot" style={{ background: palette.get(selFolderKey) ?? NO_FOLDER_COLOR }} />
            <select value={selected.folder_id ?? ""} disabled={!selLocal} title="Chuyển ghi chú sang thư mục khác"
                    onChange={(e) => onMoveNote(selected.id, e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Không thư mục</option>
              {folderList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {(tagsById.get(selected.id) ?? []).length > 0 && (
            <div className="chip-row">
              {(tagsById.get(selected.id) ?? []).map((t) => (
                <button key={t} className={"chip" + (tag === t ? " active" : "")} onClick={() => setTag(tag === t ? null : t)} title="Lọc graph theo thẻ này">#{t}</button>
              ))}
            </div>
          )}
          {selLocal && <div className="graph-preview">{preview(selLocal.content) || <span className="muted">(Ghi chú trống)</span>}</div>}
          <div className="graph-card-actions">
            <button className="primary" onClick={() => onOpenNote(selected.id)}>Mở ghi chú</button>
            {selected.has_file && <button onClick={() => onOpenPdf(selected.id)}>📕 Mở PDF</button>}
            {focusId === selected.id
              ? <button onClick={() => setFocusId(null)}>Xem toàn bộ</button>
              : <button onClick={() => setFocusId(selected.id)} title="Chỉ hiện ghi chú này và các ghi chú nối với nó">Chỉ lân cận</button>}
            <button onClick={() => setSelectedId(null)}>Đóng</button>
          </div>
          <div className="muted small">{neighborInfo.length} ghi chú liên kết</div>
          {neighborInfo.length > 0 && (
            <ul className="neighbor-list">
              {neighborInfo.map(({ node: n, edge }) => (
                <li key={n.id}>
                  <button onClick={() => goTo(n.id)}>
                    <span className="dot" style={{ background: colorOf(n) }} /> <span className="nl-title">{n.title}</span>
                    <span className="badge" title={edge.semantic_score !== null ? `Mức giống nhau về nội dung (AI tính)${edge.accepted ? ", bạn đã xác nhận ✓" : ""}` : "Liên kết bạn tự tạo bằng [[…]]"}>
                      {edge.wiki ? "[[ ]]" : ""}{edge.wiki && edge.semantic_score !== null ? " · " : ""}
                      {edge.semantic_score !== null ? `${edge.accepted ? "✓ " : ""}giống ${Math.round(edge.semantic_score * 100)}%` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
