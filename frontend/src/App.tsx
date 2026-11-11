import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";
import AuthScreen from "./components/AuthScreen.tsx";
import { Ribbon, StatusBar, TabBar } from "./components/Chrome.tsx";
import type { TabView } from "./components/Chrome.tsx";
import EditorPane from "./components/EditorPane.tsx";
import GraphView from "./components/GraphView.tsx";
import PdfViewer from "./components/PdfViewer.tsx";
import { LeftSidebar, RightSidebar } from "./components/Sidebars.tsx";
import type { ChatMsg } from "./components/Sidebars.tsx";
import { HttpApi } from "./lib/api.ts";
import type { Session } from "./lib/api.ts";
import { SyncEngine } from "./lib/engine.ts";
import { openIdbStore } from "./lib/idb.ts";
import { startLive } from "./lib/live.ts";
import type { LiveState } from "./lib/live.ts";
import { buildLinkIndex, extractOutline, extractTags, fold, fuzzyFilter, wordCount } from "./lib/text.ts";
import { ApiError, NetworkError } from "./lib/types.ts";
import type { LocalNote } from "./lib/types.ts";
import { applyTheme, loadUi, saveUi } from "./lib/ui.ts";
import type { LeftTab, RightTab, UiState } from "./lib/ui.ts";
import { uuid } from "./lib/uuid.ts";

const SESSION_KEY = "pkm.session";
const DEVICE_KEY = "pkm.device";

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // trình duyệt chặn bộ nhớ: phiên chỉ sống trong tab này
  }
}
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

// ================================================================== vỏ: đăng nhập → khởi động engine
export default function App() {
  const [session, setSession] = useState<Session | null>(readSession);
  const login = (s: Session) => {
    writeSession(s);
    setSession(s);
  };
  const logout = useCallback(() => {
    writeSession(null);
    setSession(null);
  }, []);
  if (!session) return <AuthScreen onLogin={login} />;
  return <Boot key={session.userId} session={session} onLogout={logout} />;
}

interface Live {
  engine: SyncEngine;
  api: HttpApi;
  state: LiveState;
  wake: () => void;
}

function Boot({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [state, setState] = useState<LiveState>("connecting");
  const logoutRef = useRef(onLogout);
  logoutRef.current = onLogout;

  useEffect(() => {
    const dev = deviceId();
    const api = new HttpApi({ deviceId: dev, getToken: () => session.token });
    const engine = new SyncEngine(api, openIdbStore(`pkm-${session.userId}`), { deviceId: dev });
    engine.onUnauthorized = () => logoutRef.current();
    let handle: { stop(): void; wake(): void } | null = null;
    let cancelled = false;
    void engine.init().then(() => {
      if (cancelled) return;
      handle = startLive(engine, api, setState);
      setLive({ engine, api, state: "connecting", wake: () => handle?.wake() });
    });
    const onOnline = () => handle?.wake();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      handle?.stop();
      engine.dispose();
      setLive(null);
    };
  }, [session]);

  if (!live) return <div className="boot">Đang mở kho ghi chú…</div>;
  return <Workspace session={session} onLogout={onLogout} live={{ ...live, state }} />;
}

// ================================================================== không gian làm việc
type Tab = { id: string; kind: "note" | "pdf" | "graph"; key?: string };
type Dialog = null | "switcher" | "palette" | "settings";

function uniqueTitle(notes: LocalNote[], base: string): string {
  const taken = new Set(notes.map((n) => fold(n.title)));
  if (!taken.has(fold(base))) return base;
  for (let i = 2; ; i++) if (!taken.has(fold(`${base} ${i}`))) return `${base} ${i}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Workspace({ session, onLogout, live }: { session: Session; onLogout: () => void; live: Live }) {
  const { engine, api } = live;
  const online = live.state === "live";
  const notes = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [ui, setUiState] = useState<UiState>(loadUi);
  const setUi = useCallback((patch: Partial<UiState>) => setUiState((u) => ({ ...u, ...patch })), []);
  useEffect(() => {
    saveUi(ui);
    applyTheme(ui.theme);
  }, [ui]);

  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 799px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 799px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatId = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const byKey = useMemo(() => new Map(notes.map((n) => [n.key, n])), [notes]);
  const linkIndex = useMemo(() => buildLinkIndex(notes), [notes]);
  const noteTags = useMemo(() => new Map(notes.map((n) => [n.key, extractTags(n.content)])), [notes]);
  const tagCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const tags of noteTags.values()) for (const t of tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [noteTags]);

  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Đóng tab của ghi chú đã bị xóa (kể cả xóa từ thiết bị khác).
  useEffect(() => {
    setTabs((ts) => {
      const kept = ts.filter((t) => !t.key || byKey.has(t.key));
      return kept.length === ts.length ? ts : kept;
    });
  }, [byKey]);
  useEffect(() => {
    if (activeId && !tabs.some((t) => t.id === activeId)) setActiveId(tabs.length ? tabs[tabs.length - 1].id : null);
  }, [tabs, activeId]);

  // Theo dõi trạng thái lập chỉ mục của các ghi chú vừa lưu.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    if (!online) return;
    const t = window.setInterval(() => {
      for (const n of notesRef.current) {
        if (n.id !== null && !n.dirty && (n.status === "pending" || n.status === "indexing")) void engine.refreshStatus(n.key);
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [engine, online]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (engine.pendingCount() > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [engine]);

  // ---------------------------------------------------------------- mở / tạo
  const activate = useCallback((tab: Tab) => {
    setTabs((ts) => (ts.some((t) => t.id === tab.id) ? ts : [...ts, tab]));
    setActiveId(tab.id);
    if (window.matchMedia("(max-width: 799px)").matches) setUiState((u) => ({ ...u, leftOpen: false, rightOpen: false }));
  }, []);
  const openKey = useCallback((key: string) => activate({ id: `note:${key}`, kind: "note", key }), [activate]);
  const openPdf = useCallback((key: string) => activate({ id: `pdf:${key}`, kind: "pdf", key }), [activate]);
  const openGraph = useCallback(() => activate({ id: "graph", kind: "graph" }), [activate]);
  const openId = useCallback(async (id: number) => {
    let key = engine.keyById(id);
    if (!key) {
      try {
        key = await engine.adoptRemote(id);
      } catch {
        key = null;
      }
    }
    if (key) openKey(key);
    else flash("Không tìm thấy ghi chú này");
  }, [engine, openKey, flash]);
  const openPdfById = useCallback((id: number) => {
    const key = engine.keyById(id);
    if (key) openPdf(key);
  }, [engine, openPdf]);

  const newNote = useCallback((title?: string, content = "") => {
    const n = engine.create(uniqueTitle(notesRef.current, title?.trim() || "Chưa đặt tên"), content);
    openKey(n.key);
    return n;
  }, [engine, openKey]);

  const openTitle = useCallback((title: string) => {
    const key = linkIndex.titleToKey.get(fold(title));
    if (key) openKey(key);
    else newNote(title);
  }, [linkIndex, openKey, newNote]);

  const closeTab = useCallback((id: string) => setTabs((ts) => ts.filter((t) => t.id !== id)), []);

  const deleteNote = useCallback((key: string) => {
    engine.remove(key);
    setTabs((ts) => ts.filter((t) => t.key !== key));
  }, [engine]);

  // Đổi tên ghi chú: cập nhật mọi [[liên kết]] trỏ tới tên cũ (như Obsidian).
  const renamed = useCallback((key: string, oldTitle: string, newTitle: string) => {
    const re = new RegExp(`\\[\\[\\s*${escapeRe(oldTitle.trim())}\\s*(?=[\\]|#])`, "gi");
    let changed = 0;
    for (const n of notesRef.current) {
      if (n.key === key || n.deleted) continue;
      const next = n.content.replace(re, `[[${newTitle.trim()}`);
      if (next !== n.content) {
        engine.edit(n.key, { content: next });
        changed++;
      }
    }
    if (changed) flash(`Đã cập nhật liên kết trong ${changed} ghi chú`);
  }, [engine, flash]);

  // ---------------------------------------------------------------- tải lên
  const upload = useCallback(async (files: FileList | File[]) => {
    let last: string | null = null;
    for (const f of Array.from(files)) {
      try {
        const r = await api.upload(f);
        last = await engine.adoptRemote(r.id);
      } catch (e) {
        flash(e instanceof ApiError ? `${f.name}: ${e.detail}` : e instanceof NetworkError ? "Cần kết nối mạng để tải lên" : `${f.name}: lỗi tải lên`);
      }
    }
    if (last) {
      openKey(last);
      flash("Đã tải lên. Hệ thống đang lập chỉ mục và tự tìm liên kết…");
    }
  }, [api, engine, openKey, flash]);

  // ---------------------------------------------------------------- hỏi đáp
  const ask = useCallback(async (q: string) => {
    setChat((m) => [...m, { id: chatId.current++, role: "user", text: q }]);
    setChatBusy(true);
    try {
      const r = await api.chat(q, ui.chatUseGraph);
      setChat((m) => [...m, { id: chatId.current++, role: "assistant", text: r.answer, sources: r.sources }]);
    } catch (e) {
      const text = e instanceof ApiError ? e.detail : "Không kết nối được máy chủ";
      setChat((m) => [...m, { id: chatId.current++, role: "error", text }]);
    } finally {
      setChatBusy(false);
    }
  }, [api, ui.chatUseGraph]);

  // ---------------------------------------------------------------- dẫn xuất cho giao diện
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const activeNote = active?.key ? byKey.get(active.key) ?? null : null;
  const noteForPanels = active?.kind === "note" ? activeNote : null;
  const tabViews: TabView[] = tabs.map((t) => {
    const n = t.key ? byKey.get(t.key) : undefined;
    const title = t.kind === "graph" ? "Graph view" : t.kind === "pdf" ? `PDF · ${n?.title ?? ""}` : n?.title ?? "";
    return { id: t.id, kind: t.kind, title, dirty: !!n && (n.dirty || n.id === null), conflict: !!n?.has_conflict };
  });
  const outline = useMemo(() => (noteForPanels ? extractOutline(noteForPanels.content) : []), [noteForPanels?.content]); // eslint-disable-line react-hooks/exhaustive-deps
  const graphKey = `${notes.length}:${notes.filter((n) => n.status === "ready").length}:${notes.reduce((s, n) => s + n.base_version, 0)}`;
  const graphOpen = tabs.some((t) => t.kind === "graph");

  const toggleMode = useCallback(() => setUi({ mode: ui.mode === "read" ? "edit" : "read" }), [ui.mode, setUi]);
  const syncNow = useCallback(() => {
    live.wake();
    void engine.syncAll();
  }, [live, engine]);
  const openChat = useCallback(() => setUi({ rightOpen: true, rightTab: "chat" as RightTab }), [setUi]);

  const commands = useMemo(() => [
    { name: "Ghi chú mới", hint: "Ctrl+N", run: () => newNote() },
    { name: "Mở nhanh ghi chú", hint: "Ctrl+O", run: () => setDialog("switcher") },
    { name: "Mở Graph view", hint: "Ctrl+G", run: openGraph },
    { name: "Chuyển chế độ chỉnh sửa / xem", hint: "Ctrl+E", run: toggleMode },
    { name: "Chế độ chia đôi (soạn + xem)", hint: "", run: () => setUi({ mode: "split" }) },
    { name: "Tải lên file .md / .pdf", hint: "", run: () => fileInput.current?.click() },
    { name: "Hỏi đáp trên ghi chú", hint: "", run: openChat },
    { name: "Bật/tắt thanh bên trái", hint: "", run: () => setUi({ leftOpen: !ui.leftOpen }) },
    { name: "Bật/tắt thanh bên phải", hint: "", run: () => setUi({ rightOpen: !ui.rightOpen }) },
    { name: "Tìm kiếm trong tất cả ghi chú", hint: "", run: () => setUi({ leftOpen: true, leftTab: "search" as LeftTab }) },
    { name: "Đồng bộ ngay", hint: "", run: syncNow },
    { name: ui.theme === "dark" ? "Chuyển giao diện sáng" : "Chuyển giao diện tối", hint: "", run: () => setUi({ theme: ui.theme === "dark" ? "light" : "dark" }) },
    { name: "Cài đặt", hint: "Ctrl+,", run: () => setDialog("settings") },
    { name: "Đăng xuất", hint: "", run: onLogout },
  ], [newNote, openGraph, toggleMode, openChat, setUi, syncNow, ui.leftOpen, ui.rightOpen, ui.theme, onLogout]);

  // ---------------------------------------------------------------- phím tắt
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") return setDialog(null);
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = {
        n: () => newNote(), o: () => setDialog("switcher"), p: () => setDialog("palette"),
        g: openGraph, e: toggleMode, ",": () => setDialog("settings"),
      };
      if (act[k]) {
        e.preventDefault();
        act[k]();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [newNote, openGraph, toggleMode]);

  // ---------------------------------------------------------------- kéo đổi độ rộng sidebar
  const drag = (side: "left" | "right") => (e: RPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = side === "left" ? ui.leftW : ui.rightW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = Math.min(520, Math.max(200, start + (side === "left" ? dx : -dx)));
      setUiState((u) => ({ ...u, [side === "left" ? "leftW" : "rightW"]: w }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const leftEl = ui.leftOpen && (
    <LeftSidebar
      notes={notes} activeKey={active?.key ?? null} tab={ui.leftTab} setTab={(t) => setUi({ leftTab: t })}
      noteTags={noteTags} tagCounts={tagCounts} tagFilter={tagFilter} setTagFilter={setTagFilter}
      api={api} online={online} onOpenKey={openKey} onOpenId={(id) => void openId(id)}
      onNew={() => newNote()} onUpload={() => fileInput.current?.click()}
    />
  );
  const rightEl = ui.rightOpen && (
    <RightSidebar
      tab={ui.rightTab} setTab={(t) => setUi({ rightTab: t })} note={noteForPanels} notes={notes} linkIndex={linkIndex}
      api={api} online={online} keyById={(id) => engine.keyById(id)} onOpenKey={openKey} onOpenId={(id) => void openId(id)}
      onCreateTitle={(t) => newNote(t)} outline={outline}
      onJump={(line) => { if (ui.mode === "read") setUi({ mode: "split" }); setJump({ line, nonce: Date.now() }); }}
      chat={{
        messages: chat, busy: chatBusy, useGraph: ui.chatUseGraph, setUseGraph: (b) => setUi({ chatUseGraph: b }),
        onAsk: (q) => void ask(q), onClear: () => setChat([]),
      }}
    />
  );

  return (
    <div className={"app" + (narrow ? " narrow" : "")}>
      <div className="app-body">
        <Ribbon
          leftOpen={ui.leftOpen} graphActive={active?.kind === "graph"}
          onToggleLeft={() => setUi({ leftOpen: !ui.leftOpen })} onNew={() => newNote()}
          onSwitcher={() => setDialog("switcher")} onGraph={openGraph} onUpload={() => fileInput.current?.click()}
          onChat={openChat} onPalette={() => setDialog("palette")} onSync={syncNow} onSettings={() => setDialog("settings")}
        />
        {leftEl && (
          <>
            <div className="side-wrap left" style={narrow ? undefined : { width: ui.leftW }}>{leftEl}</div>
            {!narrow && <div className="resizer" onPointerDown={drag("left")} />}
          </>
        )}
        <main className="main">
          <TabBar
            tabs={tabViews} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={() => newNote()}
            onToggleRight={() => setUi({ rightOpen: !ui.rightOpen })} rightOpen={ui.rightOpen}
          />
          <div className="content">
            {tabs.length === 0 && (
              <div className="welcome">
                <h2>🧠 Kho tri thức của {session.username}</h2>
                <p className="muted">{notes.length} ghi chú · các ghi chú liên quan được tự động liên kết theo ngữ nghĩa.</p>
                <div className="welcome-actions">
                  <button className="primary" onClick={() => newNote()}>✚ Ghi chú mới <kbd>Ctrl+N</kbd></button>
                  <button onClick={() => setDialog("switcher")}>🔎 Mở nhanh <kbd>Ctrl+O</kbd></button>
                  <button onClick={openGraph}>🕸 Graph view <kbd>Ctrl+G</kbd></button>
                  <button onClick={() => fileInput.current?.click()}>⬆ Tải lên .md / .pdf</button>
                </div>
              </div>
            )}
            {tabs.map((t) => {
              const n = t.key ? byKey.get(t.key) : undefined;
              const shown = t.id === activeId;
              if (t.kind === "graph") {
                return (
                  <div key={t.id} className="tab-panel" hidden={!shown}>
                    <GraphView api={api} activeNoteId={noteForPanels?.id ?? null} refreshKey={graphKey} visible={shown}
                               onOpenNote={(id) => void openId(id)} onOpenPdf={openPdfById} />
                  </div>
                );
              }
              if (!n) return null;
              return (
                <div key={t.id} className="tab-panel" hidden={!shown}>
                  {t.kind === "pdf" ? (
                    <PdfViewer note={n} api={api} onOpenNote={() => openKey(n.key)} />
                  ) : (
                    <EditorPane
                      note={n} engine={engine} notes={notes} mode={ui.mode} setMode={(m) => setUi({ mode: m })}
                      fontSize={ui.fontSize} exists={(title) => linkIndex.titleToKey.has(fold(title))}
                      onOpenTitle={openTitle} onOpenPdf={openPdf} onDelete={deleteNote} onRenamed={renamed}
                      onTag={(tag) => { setTagFilter(tag); setUi({ leftOpen: true, leftTab: "files" }); }}
                      jump={shown ? jump : null}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </main>
        {rightEl && (
          <>
            {!narrow && <div className="resizer" onPointerDown={drag("right")} />}
            <div className="side-wrap right" style={narrow ? undefined : { width: ui.rightW }}>{rightEl}</div>
          </>
        )}
        {narrow && (ui.leftOpen || ui.rightOpen) && <div className="backdrop" onClick={() => setUi({ leftOpen: false, rightOpen: false })} />}
      </div>
      <StatusBar
        live={live.state} pending={engine.pendingCount()} note={noteForPanels} username={session.username}
        words={noteForPanels ? wordCount(noteForPanels.content) : 0} chars={noteForPanels ? noteForPanels.content.length : 0}
        onSyncNow={syncNow}
      />

      <input ref={fileInput} type="file" accept=".md,.txt,.pdf" multiple hidden
             onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />

      {toast && <div className="toast" role="status" onClick={() => setToast(null)}>{toast}</div>}

      {dialog === "switcher" && (
        <Switcher notes={notes} onClose={() => setDialog(null)}
                  onPick={(key) => { setDialog(null); openKey(key); }}
                  onCreate={(title) => { setDialog(null); newNote(title); }} />
      )}
      {dialog === "palette" && (
        <Modal onClose={() => setDialog(null)}>
          <Palette commands={commands} onDone={() => setDialog(null)} />
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal onClose={() => setDialog(null)}>
          <h3>Cài đặt</h3>
          <div className="settings">
            <label>Giao diện
              <div className="seg">
                <button className={ui.theme === "dark" ? "active" : ""} onClick={() => setUi({ theme: "dark" })}>Tối</button>
                <button className={ui.theme === "light" ? "active" : ""} onClick={() => setUi({ theme: "light" })}>Sáng</button>
              </div>
            </label>
            <label>Cỡ chữ: <b>{ui.fontSize}px</b>
              <input type="range" min={12} max={24} value={ui.fontSize} onChange={(e) => setUi({ fontSize: Number(e.target.value) })} />
            </label>
            <label>Chế độ soạn thảo mặc định
              <div className="seg">
                {(["edit", "split", "read"] as const).map((m) => (
                  <button key={m} className={ui.mode === m ? "active" : ""} onClick={() => setUi({ mode: m })}>
                    {m === "edit" ? "Soạn" : m === "split" ? "Chia đôi" : "Xem"}
                  </button>
                ))}
              </div>
            </label>
            <div className="muted small">
              Tài khoản: <b>{session.username}</b> · Thiết bị: <code>{deviceId().slice(0, 8)}</code><br />
              Ghi chú được lưu ngay trên thiết bị (dùng được khi ngoại tuyến) và tự đồng bộ khi có mạng.
            </div>
            <div className="modal-actions">
              <button className="danger" onClick={() => { if (engine.pendingCount() === 0 || confirm("Còn thay đổi chưa đồng bộ trên thiết bị này. Vẫn đăng xuất?")) onLogout(); }}>Đăng xuất</button>
              <button onClick={() => setDialog(null)}>Đóng</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ================================================================== hộp thoại
function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Switcher({ notes, onPick, onCreate, onClose }: {
  notes: LocalNote[]; onPick: (key: string) => void; onCreate: (title: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const items = useMemo(() => (q.trim() ? fuzzyFilter(notes, q, (n) => n.title, 12) : notes.slice(0, 12)), [notes, q]);
  const canCreate = q.trim() !== "" && !notes.some((n) => fold(n.title) === fold(q.trim()));
  const total = items.length + (canCreate ? 1 : 0);
  const choose = (idx: number) => {
    if (idx < items.length) onPick(items[idx].key);
    else if (canCreate) onCreate(q.trim());
  };
  return (
    <Modal onClose={onClose}>
      <input className="search-input big" autoFocus placeholder="Gõ tên ghi chú để mở, hoặc tạo mới…" value={q}
             onChange={(e) => { setQ(e.target.value); setI(0); }}
             onKeyDown={(e) => {
               if (e.key === "ArrowDown") { e.preventDefault(); setI((i + 1) % Math.max(total, 1)); }
               else if (e.key === "ArrowUp") { e.preventDefault(); setI((i - 1 + Math.max(total, 1)) % Math.max(total, 1)); }
               else if (e.key === "Enter") { e.preventDefault(); choose(i); }
             }} />
      <ul className="pick-list">
        {items.map((n, k) => (
          <li key={n.key}><button className={k === i ? "active" : ""} onMouseEnter={() => setI(k)} onClick={() => choose(k)}>
            {n.source === "pdf" ? "📕" : "📄"} {n.title}
          </button></li>
        ))}
        {canCreate && (
          <li><button className={i === items.length ? "active" : ""} onMouseEnter={() => setI(items.length)} onClick={() => choose(items.length)}>
            ✚ Tạo ghi chú “{q.trim()}”
          </button></li>
        )}
        {total === 0 && <li className="muted pad">Chưa có ghi chú nào.</li>}
      </ul>
    </Modal>
  );
}

function Palette({ commands, onDone }: { commands: { name: string; hint: string; run: () => void }[]; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const items = useMemo(() => (q.trim() ? fuzzyFilter(commands, q, (c) => c.name, 12) : commands), [commands, q]);
  const run = (idx: number) => {
    const c = items[idx];
    if (!c) return;
    onDone();
    c.run();
  };
  return (
    <>
      <input className="search-input big" autoFocus placeholder="Gõ tên lệnh…" value={q}
             onChange={(e) => { setQ(e.target.value); setI(0); }}
             onKeyDown={(e) => {
               if (e.key === "ArrowDown") { e.preventDefault(); setI((i + 1) % Math.max(items.length, 1)); }
               else if (e.key === "ArrowUp") { e.preventDefault(); setI((i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1)); }
               else if (e.key === "Enter") { e.preventDefault(); run(i); }
             }} />
      <ul className="pick-list">
        {items.map((c, k) => (
          <li key={c.name}><button className={k === i ? "active" : ""} onMouseEnter={() => setI(k)} onClick={() => run(k)}>
            <span>{c.name}</span>{c.hint && <kbd>{c.hint}</kbd>}
          </button></li>
        ))}
        {items.length === 0 && <li className="muted pad">Không có lệnh phù hợp.</li>}
      </ul>
    </>
  );
}
