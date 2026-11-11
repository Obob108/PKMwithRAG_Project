import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HttpApi } from "../lib/api.ts";
import { buildView, createSim, hitTest, highlightSet, isSettled, neighborSet, stepSim } from "../lib/graphModel.ts";
import type { GraphData, Sim, SimNode } from "../lib/graphModel.ts";
import { fold } from "../lib/text.ts";

interface Props {
  api: HttpApi;
  activeNoteId: number | null;
  /** Đổi giá trị này khi ghi chú/liên kết có thể đã đổi để tải lại graph. */
  refreshKey: string;
  visible: boolean;
  onOpenNote: (id: number) => void;
  onOpenPdf: (id: number) => void;
}

interface Colors {
  bg: string; fg: string; muted: string; accent: string; md: string; pdf: string; edge: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#1e1e1e"), fg: v("--fg", "#dcddde"), muted: v("--muted", "#999"), accent: v("--accent", "#7c6cf0"),
    md: v("--node-md", "#8b8bff"), pdf: v("--node-pdf", "#f08a5d"), edge: v("--edge", "#888"),
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export default function GraphView({ api, activeNoteId, refreshKey, visible, onOpenNote, onOpenPdf }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [minScore, setMinScore] = useState(0.75);
  const [showOrphans, setShowOrphans] = useState(false);
  const [labels, setLabels] = useState(true);
  const [depth, setDepth] = useState(1);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const tf = useRef({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef(true);
  const fitRequest = useRef(false);
  const dragging = useRef(false);
  const hoverId = useRef<number | null>(null);
  const alphas = useRef(new Map<number, number>());
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

  const view = useMemo<GraphData>(
    () => (data ? buildView(data, { minScore, showOrphans, focusId, depth }) : { nodes: [], edges: [] }),
    [data, minScore, showOrphans, focusId, depth],
  );
  const selected = view.nodes.find((n) => n.id === selectedId) ?? null;
  const neighbors = useMemo(
    () => (selected ? view.nodes.filter((n) => neighborSet(view.edges, selected.id).has(n.id)) : []),
    [selected, view],
  );

  // Trạng thái mới nhất cho vòng vẽ (tránh dựng lại vòng lặp mỗi lần đổi).
  const live = useRef({ view, selectedId: selected ? selected.id : null, search, labels });
  live.current = { view, selectedId: selected ? selected.id : null, search, labels };

  // Dựng mô phỏng mới khi dữ liệu hiển thị đổi, giữ vị trí cũ để graph không "nhảy".
  useEffect(() => {
    const prev = simRef.current ? new Map(simRef.current.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : undefined;
    const sim = createSim(view, prev);
    if (!prev || prev.size === 0) {
      for (let i = 0; i < 150; i++) stepSim(sim);
      sim.alpha = 0.3;
      fitRequest.current = true;
    }
    simRef.current = sim;
    dirty.current = true;
  }, [view]);

  useEffect(() => {
    dirty.current = true;
  }, [selectedId, search, labels]);

  const fit = useCallback(() => {
    const sim = simRef.current;
    const { w, h } = size.current;
    if (!sim || sim.nodes.length === 0 || w === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of sim.nodes) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
    }
    const k = clamp(Math.min(w / (x1 - x0 + 120), h / (y1 - y0 + 120)), 0.25, 2);
    tf.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    dirty.current = true;
  }, []);

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

  // Vòng mô phỏng + vẽ.
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
        fit();
        fitRequest.current = false;
      }
      let moving = false;
      if (!isSettled(sim) || dragging.current) {
        stepSim(sim);
        stepSim(sim);
        moving = true;
      }
      const { view: v, selectedId: sel, search: q, labels: showLabels } = live.current;
      const hl = highlightSet(v.edges, sel);
      const foldedQ = fold(q.trim());
      const matches = foldedQ ? new Set(v.nodes.filter((n) => fold(n.title).includes(foldedQ)).map((n) => n.id)) : null;
      let animating = false;
      for (const n of v.nodes) {
        const target = hl ? (hl.has(n.id) ? 1 : 0.12) : matches ? (matches.has(n.id) ? 1 : 0.15) : 1;
        const cur = alphas.current.get(n.id) ?? target;
        const next = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * 0.25;
        if (next !== target) animating = true;
        alphas.current.set(n.id, next);
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

      for (const e of v.edges) {
        const a = sim.nodes[sim.index.get(e.source) ?? -1];
        const b = sim.nodes[sim.index.get(e.target) ?? -1];
        if (!a || !b) continue;
        const touches = sel !== null && (e.source === sel || e.target === sel);
        const base = touches ? 1 : e.wiki ? 0.75 : 0.25 + 0.35 * clamp(e.semantic_score ?? 0.5, 0, 1);
        c.globalAlpha = Math.min(alphaOf(e.source), alphaOf(e.target)) * base;
        c.strokeStyle = touches || e.wiki ? col.accent : col.edge;
        c.lineWidth = touches ? 2 : e.wiki ? 1.6 : 1;
        c.beginPath();
        c.moveTo(tx + a.x * k, ty + a.y * k);
        c.lineTo(tx + b.x * k, ty + b.y * k);
        c.stroke();
      }

      const info = new Map(v.nodes.map((n) => [n.id, n]));
      for (const n of sim.nodes) {
        const meta = info.get(n.id);
        if (!meta) continue;
        const al = alphaOf(n.id);
        const sx = tx + n.x * k;
        const sy = ty + n.y * k;
        const rr = n.r * clamp(k, 0.7, 1.5);
        c.globalAlpha = al;
        c.fillStyle = meta.source === "pdf" ? col.pdf : col.md;
        c.beginPath();
        c.arc(sx, sy, rr, 0, Math.PI * 2);
        c.fill();
        if (n.id === sel || n.id === hoverId.current) {
          c.strokeStyle = n.id === sel ? col.accent : col.fg;
          c.lineWidth = n.id === sel ? 3 : 1.5;
          c.stroke();
        }
        const showLabel = showLabels && (k > 0.9 || (hl?.has(n.id) ?? false) || n.id === hoverId.current || meta.degree >= 4);
        if (showLabel && al > 0.3) {
          c.globalAlpha = al;
          c.fillStyle = col.fg;
          c.font = "11px system-ui, sans-serif";
          c.textAlign = "center";
          const t = meta.title.length > 28 ? meta.title.slice(0, 27) + "…" : meta.title;
          c.fillText(t, sx, sy + rr + 13);
        }
      }
      c.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [visible, fit]);

  // Tương tác: kéo nút, kéo nền, thu phóng (con lăn / chụm 2 ngón), chạm nút, chạm đôi để mở.
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
      const t = tf.current;
      const k = clamp(t.k * factor, 0.15, 4);
      tf.current = { k, x: px - (px - t.x) * (k / t.k), y: py - (py - t.y) * (k / t.k) };
      dirty.current = true;
    };
    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        gesture = { ...gesture, kind: "pinch", dist: pinchDist(), moved: true };
        return;
      }
      const w = world(p.x, p.y);
      const sim = simRef.current;
      const hit = sim ? hitTest(sim, w.x, w.y, 6 / tf.current.k) : null;
      gesture = { kind: hit ? "node" : "pan", node: hit, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, dist: 0 };
    };

    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (gesture.kind === "pinch" && pointers.size >= 2) {
        const d = pinchDist();
        const [a, b] = [...pointers.values()];
        if (gesture.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesture.dist);
        gesture.dist = d;
        return;
      }
      if (gesture.kind === "node" && gesture.node) {
        if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 4) gesture.moved = true;
        if (gesture.moved) {
          const w = world(p.x, p.y);
          gesture.node.fixed = true;
          gesture.node.x = w.x;
          gesture.node.y = w.y;
          dragging.current = true;
          if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.3);
        }
        return;
      }
      if (gesture.kind === "pan") {
        if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 4) gesture.moved = true;
        if (gesture.moved) {
          tf.current = { ...tf.current, x: tf.current.x + (p.x - gesture.lx), y: tf.current.y + (p.y - gesture.ly) };
          dirty.current = true;
        }
        gesture.lx = p.x;
        gesture.ly = p.y;
        return;
      }
      // di chuột (không nhấn): tô sáng nút đang trỏ vào
      const w = world(p.x, p.y);
      const hit = simRef.current ? hitTest(simRef.current, w.x, w.y, 6 / tf.current.k) : null;
      const id = hit ? hit.id : null;
      if (id !== hoverId.current) {
        hoverId.current = id;
        cv.style.cursor = id !== null ? "pointer" : "grab";
        dirty.current = true;
      }
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
            propsRef.current.onOpenNote(n.id);
            lastTap = { id: -1, t: 0 };
          } else {
            lastTap = { id: n.id, t: now };
            setSelectedId(n.id);
          }
        }
        n.fixed = false;
        dragging.current = false;
      } else if (gesture.kind === "pan" && !gesture.moved) {
        setSelectedId(null);
      }
      gesture = { ...gesture, kind: "none", node: null };
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };

    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, []);

  const focusTitle = focusId !== null ? data?.nodes.find((n) => n.id === focusId)?.title : null;

  return (
    <div className="graph-pane" ref={wrapRef}>
      <canvas ref={canvasRef} className="graph-canvas" />

      {view.nodes.length === 0 && !loading && (
        <div className="graph-empty">
          {error ?? "Chưa có liên kết nào để hiển thị. Thêm ghi chú liên quan, dùng [[liên kết]], hạ ngưỡng ở bảng điều khiển, hoặc bật “Hiện ghi chú mồ côi”."}
        </div>
      )}

      <div className={"graph-controls" + (panelOpen ? "" : " collapsed")}>
        <button className="graph-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-label="Bảng điều khiển graph">{panelOpen ? "▾ Bộ lọc" : "▸ Bộ lọc"}</button>
        {panelOpen && (
          <>
            <input className="search-input" placeholder="Làm nổi bật theo tên…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="slider">
              <span>Ngưỡng liên kết ngữ nghĩa: <b>{minScore.toFixed(2)}</b></span>
              <input type="range" min={0.6} max={0.95} step={0.01} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </label>
            <label className="check"><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> Hiện ghi chú mồ côi</label>
            <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Hiện nhãn</label>
            <label className="check">
              <input type="checkbox" checked={focusId !== null} disabled={activeNoteId === null && focusId === null}
                     onChange={(e) => setFocusId(e.target.checked ? activeNoteId : null)} />
              Chỉ lân cận{focusTitle ? `: ${focusTitle}` : " ghi chú đang mở"}
            </label>
            {focusId !== null && (
              <label className="slider"><span>Độ sâu: <b>{depth}</b></span>
                <input type="range" min={1} max={3} step={1} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
              </label>
            )}
            <div className="graph-buttons">
              <button onClick={() => { fitRequest.current = true; }}>Căn lại</button>
              <button onClick={load} disabled={loading}>{loading ? "Đang tải…" : "Làm mới"}</button>
            </div>
            <div className="muted small">{view.nodes.length} ghi chú · {view.edges.length} liên kết</div>
            <div className="legend small"><span className="dot md" /> Ghi chú <span className="dot pdf" /> PDF · đường đậm: [[liên kết]], mảnh: ngữ nghĩa</div>
          </>
        )}
      </div>

      {selected && (
        <div className="graph-card">
          <div className="graph-card-title">{selected.source === "pdf" ? "📕" : "📄"} {selected.title}</div>
          <div className="muted small">{neighbors.length} ghi chú liên quan</div>
          <div className="graph-card-actions">
            <button className="primary" onClick={() => onOpenNote(selected.id)}>Mở ghi chú</button>
            {selected.has_file && <button onClick={() => onOpenPdf(selected.id)}>📕 Mở PDF</button>}
            <button onClick={() => setFocusId(selected.id)} title="Chỉ hiện ghi chú này và các ghi chú nối với nó">Chỉ lân cận</button>
            <button onClick={() => setSelectedId(null)}>Bỏ chọn</button>
          </div>
          {neighbors.length > 0 && (
            <ul className="neighbor-list">
              {neighbors.map((n) => (
                <li key={n.id}><button onClick={() => setSelectedId(n.id)}>{n.source === "pdf" ? "📕" : "📄"} {n.title}</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
