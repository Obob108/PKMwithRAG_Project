import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons.tsx";
import type { ReactNode } from "react";
import type { LiveState } from "../lib/live.ts";
import type { LocalNote } from "../lib/types.ts";

// ------------------------------------------------------------------ Thanh công cụ ngang (đầu thanh bên trái)
export interface ToolbarProps {
  graphActive: boolean;
  onNew: () => void;
  onSwitcher: () => void;
  onGraph: () => void;
  onUpload: () => void;
  onChat: () => void;
  onPalette: () => void;
  onSync: () => void;
  onSettings: () => void;
  live: LiveState;
}

const toolBtn = (icon: ReactNode, title: string, onClick: () => void, cls = "") => (
  <button key={title} className={"tool-btn " + cls} title={title} aria-label={title} onClick={onClick}>{icon}</button>
);

export function Toolbar(p: ToolbarProps) {
  return (
    <nav className="toolbar" aria-label="Thanh công cụ">
      {toolBtn(<Icon name="new" />, "Ghi chú mới (Ctrl+N)", p.onNew)}
      {toolBtn(<Icon name="search" />, "Mở nhanh (Ctrl+O)", p.onSwitcher)}
      {toolBtn(<Icon name="graph" />, "Graph view (Ctrl+G)", p.onGraph, p.graphActive ? "active" : "")}
      {toolBtn(<Icon name="upload" />, "Tải lên file .md / .pdf", p.onUpload)}
      {toolBtn(<Icon name="chat" />, "Hỏi đáp trên ghi chú", p.onChat)}
      <span className="spacer" />
      {toolBtn(<Icon name="command" />, "Bảng lệnh (Ctrl+P)", p.onPalette)}
      {toolBtn(<Icon name="sync" />, p.live === "live" ? "Đã kết nối · bấm để đồng bộ ngay" : "Ngoại tuyến · bấm để thử đồng bộ", p.onSync, "sync " + p.live)}
      {toolBtn(<Icon name="settings" />, "Cài đặt (Ctrl+,)", p.onSettings)}
    </nav>
  );
}

// ------------------------------------------------------------------ Người dùng (góc phải thanh tab)
const AVATAR_COLORS = ["#1b7fa6", "#3aa6c2", "#ff8a5c", "#f4978e", "#2f9e6e", "#2f9e8f", "#e0a33a", "#4f86c6"];

/** Màu avatar cố định theo tên đăng nhập (cùng tên → cùng màu trên mọi thiết bị). */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialOf(name: string): string {
  const ch = [...name.trim()][0] ?? "?";
  return ch.toLocaleUpperCase("vi");
}

interface UserMenuProps {
  username: string;
  live: LiveState;
  pending: number;
  theme: "dark" | "light";
  compact: boolean; // điện thoại: chỉ hiện avatar
  onSettings: () => void;
  onSync: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function UserMenu(p: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const status = p.live === "live" ? (p.pending ? `Đang đồng bộ ${p.pending} thay đổi…` : "Đã đồng bộ")
    : p.live === "connecting" ? "Đang kết nối…" : `Ngoại tuyến${p.pending ? ` · ${p.pending} thay đổi chờ gửi` : ""}`;
  const item = (icon: ReactNode, label: string, run: () => void, cls = "") => (
    <button role="menuitem" className={"menu-item " + cls} onClick={() => { setOpen(false); run(); }}>{icon}<span>{label}</span></button>
  );
  return (
    <div className="user-menu" ref={ref}>
      <button className={"user-chip" + (open ? " open" : "")} aria-haspopup="menu" aria-expanded={open}
              title={`Đang đăng nhập: ${p.username}`} onClick={() => setOpen(!open)}>
        <span className="avatar" style={{ background: avatarColor(p.username) }}>{initialOf(p.username)}</span>
        {!p.compact && <span className="user-name">{p.username}</span>}
        <span className={"presence " + p.live} aria-hidden />
        {!p.compact && <span className="caret" aria-hidden>▾</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="avatar big" style={{ background: avatarColor(p.username) }}>{initialOf(p.username)}</span>
            <div>
              <div className="menu-name">{p.username}</div>
              <div className={"muted small sync-text " + p.live}>● {status}</div>
            </div>
          </div>
          {item(<Icon name="settings" size={16} />, "Cài đặt", p.onSettings)}
          {item(<Icon name="sync" size={16} />, "Đồng bộ ngay", p.onSync)}
          {item(<span className="menu-glyph">{p.theme === "dark" ? "☀" : "☾"}</span>, p.theme === "dark" ? "Giao diện sáng" : "Giao diện tối", p.onToggleTheme)}
          <div className="menu-sep" />
          {item(<span className="menu-glyph">⎋</span>, "Đăng xuất", p.onLogout, "danger")}
        </div>
      )}
    </div>
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
  leftOpen: boolean;
  onToggleLeft: () => void;
  /** Công cụ rút gọn hiện cạnh nút ☰ khi thanh bên trái đang đóng. */
  quickTools?: ReactNode;
  user: ReactNode;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onToggleRight, rightOpen, leftOpen, onToggleLeft, quickTools, user }: TabBarProps) {
  const icon = (k: TabView["kind"]) => <Icon name={k === "graph" ? "graph" : k === "pdf" ? "pdf" : "note"} size={15} />;
  return (
    <div className="tabbar" role="tablist">
      <button className={"tool-btn" + (leftOpen ? " active" : "")} title="Bật/tắt thanh bên trái" aria-label="Bật/tắt thanh bên trái"
              onClick={onToggleLeft}><Icon name="menu" /></button>
      {!leftOpen && quickTools}
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
        <button className="tab-new" title="Ghi chú mới" aria-label="Ghi chú mới" onClick={onNew}><Icon name="plus" size={16} /></button>
      </div>
      <button className={"tool-btn" + (rightOpen ? " active" : "")} title="Bật/tắt thanh bên phải" aria-label="Bật/tắt thanh bên phải" onClick={onToggleRight}><Icon name="panel" /></button>
      {user}
    </div>
  );
}

// ------------------------------------------------------------------ Thanh trạng thái
interface StatusProps {
  live: LiveState;
  pending: number;
  note: LocalNote | null;
  words: number;
  chars: number;
  onSyncNow: () => void;
}

export function StatusBar({ live, pending, note, words, chars, onSyncNow }: StatusProps) {
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
    </footer>
  );
}
