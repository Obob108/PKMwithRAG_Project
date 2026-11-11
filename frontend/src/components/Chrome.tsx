import type { LiveState } from "../lib/live.ts";
import type { LocalNote } from "../lib/types.ts";

// ------------------------------------------------------------------ Ribbon (thanh công cụ dọc bên trái)
interface RibbonProps {
  leftOpen: boolean;
  graphActive: boolean;
  onToggleLeft: () => void;
  onNew: () => void;
  onSwitcher: () => void;
  onGraph: () => void;
  onUpload: () => void;
  onChat: () => void;
  onPalette: () => void;
  onSync: () => void;
  onSettings: () => void;
}

export function Ribbon(p: RibbonProps) {
  const btn = (icon: string, title: string, onClick: () => void, active = false) => (
    <button className={"ribbon-btn" + (active ? " active" : "")} title={title} aria-label={title} onClick={onClick}>{icon}</button>
  );
  return (
    <nav className="ribbon" aria-label="Thanh công cụ">
      <div className="ribbon-group">
        {btn("☰", "Bật/tắt thanh bên trái", p.onToggleLeft, p.leftOpen)}
        {btn("✚", "Ghi chú mới (Ctrl+N)", p.onNew)}
        {btn("🔎", "Mở nhanh (Ctrl+O)", p.onSwitcher)}
        {btn("🕸", "Graph view (Ctrl+G)", p.onGraph, p.graphActive)}
        {btn("⬆", "Tải lên file .md / .pdf", p.onUpload)}
        {btn("💬", "Hỏi đáp trên ghi chú", p.onChat)}
      </div>
      <div className="ribbon-group">
        {btn("⌘", "Bảng lệnh (Ctrl+P)", p.onPalette)}
        {btn("⟳", "Đồng bộ ngay", p.onSync)}
        {btn("⚙", "Cài đặt (Ctrl+,)", p.onSettings)}
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ Thanh tab
export interface TabView {
  id: string;
  kind: "note" | "pdf" | "graph";
  title: string;
  dirty: boolean;
  conflict: boolean;
}

interface TabBarProps {
  tabs: TabView[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onToggleRight: () => void;
  rightOpen: boolean;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onToggleRight, rightOpen }: TabBarProps) {
  const icon = (k: TabView["kind"]) => (k === "graph" ? "🕸" : k === "pdf" ? "📕" : "📄");
  return (
    <div className="tabbar" role="tablist">
      <div className="tabs-scroll">
        {tabs.map((t) => (
          <div key={t.id} role="tab" aria-selected={t.id === activeId}
               className={"tab" + (t.id === activeId ? " active" : "")}
               onClick={() => onSelect(t.id)}
               onAuxClick={(e) => { if (e.button === 1) onClose(t.id); }}>
            <span className="tab-icon">{icon(t.kind)}</span>
            <span className="tab-title">{t.title || "Chưa đặt tên"}</span>
            {t.conflict && <span title="Có xung đột cần xử lý">⚠</span>}
            {t.dirty && <span className="dot" title="Chưa đồng bộ" />}
            <button className="tab-close" aria-label="Đóng tab" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}>×</button>
          </div>
        ))}
        <button className="tab-new" title="Ghi chú mới" aria-label="Ghi chú mới" onClick={onNew}>＋</button>
      </div>
      <button className={"ribbon-btn small" + (rightOpen ? " active" : "")} title="Bật/tắt thanh bên phải" aria-label="Bật/tắt thanh bên phải" onClick={onToggleRight}>▤</button>
    </div>
  );
}

// ------------------------------------------------------------------ Thanh trạng thái
interface StatusProps {
  live: LiveState;
  pending: number;
  note: LocalNote | null;
  username: string;
  words: number;
  chars: number;
  onSyncNow: () => void;
}

export function StatusBar({ live, pending, note, username, words, chars, onSyncNow }: StatusProps) {
  const syncText =
    live === "live" ? (pending ? `● Đang đồng bộ ${pending} thay đổi…` : "● Đã đồng bộ (trực tiếp)")
    : live === "connecting" ? "◌ Đang kết nối…"
    : `○ Ngoại tuyến${pending ? ` — ${pending} thay đổi chờ gửi` : ""}`;
  const idx = !note ? "" : note.id === null ? "Chưa lên máy chủ"
    : note.dirty ? "Có thay đổi chưa gửi"
    : note.status === "ready" ? "Đã lập chỉ mục"
    : note.status === "failed" ? "Lập chỉ mục lỗi"
    : "Đang lập chỉ mục…";
  return (
    <footer className="statusbar">
      <button className={"status-item sync " + live} onClick={onSyncNow} title="Bấm để đồng bộ ngay">{syncText}</button>
      {note && <span className="status-item">{idx}</span>}
      {note && <span className="status-item">v{note.base_version || "–"}</span>}
      {note?.has_conflict && <span className="status-item warn">⚠ Xung đột</span>}
      <span className="spacer" />
      {note && <span className="status-item">{words} từ · {chars} ký tự</span>}
      <span className="status-item">👤 {username}</span>
    </footer>
  );
}
