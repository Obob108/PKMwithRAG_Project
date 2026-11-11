import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { ChatSource, HttpApi, RelatedItem, SearchHit } from "../lib/api.ts";
import { searchNotes } from "../lib/text.ts";
import type { LinkIndex, OutlineItem } from "../lib/text.ts";
import type { Folder, LocalNote } from "../lib/types.ts";
import type { LeftTab, RightTab } from "../lib/ui.ts";

const icon = (n: LocalNote) => (n.source === "pdf" ? "📕" : "📄");

// ================================================================== THANH BÊN TRÁI
interface LeftProps {
  notes: LocalNote[];
  activeKey: string | null;
  tab: LeftTab;
  setTab: (t: LeftTab) => void;
  noteTags: Map<string, string[]>;
  tagCounts: [string, number][];
  tagFilter: string | null;
  setTagFilter: (t: string | null) => void;
  api: HttpApi;
  online: boolean;
  onOpenKey: (key: string) => void;
  onOpenId: (id: number) => void;
  /** folderId: undefined = hỏi người dùng (nút chung), null = ngoài cùng, số = vào thư mục đó. */
  onNew: (folderId?: number | null) => void;
  onUpload: (folderId?: number | null) => void;
  folders: Folder[];
  collapsed: number[];
  onToggleFolder: (id: number) => void;
  onMove: (key: string, folderId: number | null) => void;
  onDropFiles: (files: FileList, folderId: number | null) => void;
  /** Trả về thông báo lỗi (để hiện ngay ô nhập) hoặc null nếu thành công. */
  onCreateFolder: (name: string) => Promise<string | null>;
  onRenameFolder: (id: number, name: string) => Promise<string | null>;
  onDeleteFolder: (folder: Folder, count: number) => void;
}

export function LeftSidebar(p: LeftProps) {
  return (
    <aside className="sidebar left">
      <div className="side-tabs" role="tablist">
        {(["files", "search", "tags"] as LeftTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? "active" : ""} onClick={() => p.setTab(t)}>
            {t === "files" ? "Tệp" : t === "search" ? "Tìm kiếm" : "Thẻ"}
          </button>
        ))}
      </div>
      {p.tab === "files" && <FilesPanel {...p} />}
      {p.tab === "search" && <SearchPanel notes={p.notes} api={p.api} online={p.online} onOpenKey={p.onOpenKey} onOpenId={p.onOpenId} />}
      {p.tab === "tags" && (
        <div className="panel">
          {p.tagCounts.length === 0 && <div className="muted pad">Chưa có thẻ nào. Gõ #ten-the trong ghi chú để tạo.</div>}
          {p.tagCounts.map(([tag, count]) => (
            <button key={tag} className="row" onClick={() => { p.setTagFilter(tag); p.setTab("files"); }}>
              <span>#{tag}</span><span className="badge">{count}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

const NOTE_MIME = "application/x-pkm-note";
type DropTarget = number | "root" | null;

function hasDragType(e: DragEvent, t: string): boolean {
  return Array.from(e.dataTransfer.types).includes(t);
}

/** Ô nhập tên thư mục (tạo mới hoặc đổi tên): Enter lưu, Esc hủy, bấm ra ngoài cũng lưu. */
function FolderNameInput({ initial, onSubmit, onCancel }: {
  initial: string; onSubmit: (name: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const closed = useRef(false); // đã hủy bằng Esc: bỏ qua sự kiện blur khi ô nhập biến mất
  const cancel = () => {
    closed.current = true;
    onCancel();
  };
  const submit = async () => {
    if (busy.current || closed.current) return;
    const name = value.trim();
    if (!name || name === initial) return cancel();
    busy.current = true;
    const err = await onSubmit(name);
    busy.current = false;
    if (err) setError(err);
  };
  return (
    <div className="folder-input">
      <input autoFocus value={value} placeholder="Tên thư mục" maxLength={100}
             onChange={(e) => { setValue(e.target.value); setError(null); }}
             onFocus={(e) => e.target.select()}
             onKeyDown={(e) => {
               if (e.key === "Enter") { e.preventDefault(); void submit(); }
               else if (e.key === "Escape") { e.preventDefault(); cancel(); }
             }}
             onBlur={() => { if (!error) void submit(); }} />
      {error && <div className="form-error small">{error}</div>}
    </div>
  );
}

function FilesPanel(p: LeftProps) {
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [editing, setEditing] = useState<null | "new" | number>(null); // "new" = đang tạo thư mục; số = đang đổi tên
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget>(null);

  const list = useMemo(() => {
    let l = p.tagFilter ? p.notes.filter((n) => p.noteTags.get(n.key)?.includes(p.tagFilter as string)) : p.notes;
    if (sort === "name") l = [...l].sort((a, b) => a.title.localeCompare(b.title, "vi"));
    return l;
  }, [p.notes, p.tagFilter, p.noteTags, sort]);

  const folderIds = useMemo(() => new Set(p.folders.map((f) => f.id)), [p.folders]);
  const byFolder = useMemo(() => {
    const m = new Map<number | null, LocalNote[]>();
    for (const n of list) {
      const f = n.folder_id !== null && folderIds.has(n.folder_id) ? n.folder_id : null;
      const arr = m.get(f) ?? [];
      arr.push(n);
      m.set(f, arr);
    }
    return m;
  }, [list, folderIds]);
  const totals = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of p.notes) if (n.folder_id !== null) m.set(n.folder_id, (m.get(n.folder_id) ?? 0) + 1);
    return m;
  }, [p.notes]);
  const draggedFolder = dragKey ? p.notes.find((n) => n.key === dragKey)?.folder_id ?? null : null;

  // ---------------------------------------------------------------- kéo thả (ghi chú trong app, hoặc file từ máy)
  const dropProps = (target: number | "root") => ({
    onDragOver: (e: DragEvent) => {
      if (!hasDragType(e, NOTE_MIME) && !hasDragType(e, "Files")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = hasDragType(e, "Files") ? "copy" : "move";
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === target) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      setDragKey(null);
      const folderId = target === "root" ? null : target;
      if (e.dataTransfer.files.length) return p.onDropFiles(e.dataTransfer.files, folderId);
      const key = e.dataTransfer.getData(NOTE_MIME);
      if (key) p.onMove(key, folderId);
    },
  });

  const noteRow = (n: LocalNote, nested: boolean): ReactNode => (
    <li key={n.key}>
      <button className={"file-item" + (n.key === p.activeKey ? " active" : "") + (nested ? " nested" : "") + (n.key === dragKey ? " dragging" : "")}
              draggable onClick={() => p.onOpenKey(n.key)} title={n.title}
              onDragStart={(e) => { e.dataTransfer.setData(NOTE_MIME, n.key); e.dataTransfer.effectAllowed = "move"; setDragKey(n.key); }}
              onDragEnd={() => { setDragKey(null); setOver(null); }}>
        <span className="file-icon">{icon(n)}</span>
        <span className="file-title">{n.title || "Chưa đặt tên"}</span>
        {n.has_conflict && <span title="Có xung đột">⚠</span>}
        {(n.dirty || n.id === null) && <span className="dot" title="Chưa đồng bộ" />}
      </button>
    </li>
  );

  const filtering = !!p.tagFilter;
  const rootNotes = byFolder.get(null) ?? [];

  return (
    <div className="panel" {...dropProps("root")}>
      <div className="panel-actions">
        <button onClick={() => p.onNew()} title="Ghi chú mới">✚ Mới</button>
        <button onClick={() => setEditing("new")} title="Tạo thư mục mới">📁 Thư mục</button>
        <button onClick={() => p.onUpload()} title="Tải lên .md / .pdf">⬆ Tải lên</button>
        <button onClick={() => setSort(sort === "recent" ? "name" : "recent")} title="Đổi cách sắp xếp">
          {sort === "recent" ? "⏱ Mới nhất" : "A–Z"}
        </button>
      </div>
      {p.tagFilter && (
        <div className="chip-row">
          <span className="chip">#{p.tagFilter} <button aria-label="Bỏ lọc" onClick={() => p.setTagFilter(null)}>×</button></span>
        </div>
      )}
      {editing === "new" && (
        <FolderNameInput initial="" onCancel={() => setEditing(null)}
                         onSubmit={async (name) => { const err = await p.onCreateFolder(name); if (!err) setEditing(null); return err; }} />
      )}
      {list.length === 0 && p.folders.length === 0 && (
        <div className="muted pad">{p.notes.length === 0 ? "Chưa có ghi chú. Bấm “✚ Mới” hoặc tải lên file." : "Không có ghi chú phù hợp."}</div>
      )}

      <ul className="file-list">
        {p.folders.map((f) => {
          const items = byFolder.get(f.id) ?? [];
          if (filtering && items.length === 0) return null;
          const open = filtering || !p.collapsed.includes(f.id);
          return (
            <li key={`f${f.id}`} className={"folder" + (over === f.id ? " drop-over" : "")} {...dropProps(f.id)}>
              {editing === f.id ? (
                <FolderNameInput initial={f.name} onCancel={() => setEditing(null)}
                                 onSubmit={async (name) => { const err = await p.onRenameFolder(f.id, name); if (!err) setEditing(null); return err; }} />
              ) : (
                <div className="folder-row">
                  <button className="folder-head" onClick={() => p.onToggleFolder(f.id)} aria-expanded={open} title={f.name}>
                    <span className="caret">{open ? "▾" : "▸"}</span>
                    <span className="file-icon">{open ? "📂" : "📁"}</span>
                    <span className="file-title">{f.name}</span>
                    <span className="badge">{totals.get(f.id) ?? 0}</span>
                  </button>
                  <span className="folder-actions">
                    <button title="Ghi chú mới trong thư mục này" aria-label="Ghi chú mới trong thư mục" onClick={() => p.onNew(f.id)}>✚</button>
                    <button title="Tải file lên thư mục này" aria-label="Tải lên thư mục" onClick={() => p.onUpload(f.id)}>⬆</button>
                    <button title="Đổi tên thư mục" aria-label="Đổi tên thư mục" onClick={() => setEditing(f.id)}>✎</button>
                    <button title="Xóa thư mục (ghi chú bên trong được giữ lại)" aria-label="Xóa thư mục" className="danger"
                            onClick={() => p.onDeleteFolder(f, totals.get(f.id) ?? 0)}>🗑</button>
                  </span>
                </div>
              )}
              {open && (
                <ul className="file-list">
                  {items.map((n) => noteRow(n, true))}
                  {items.length === 0 && <li className="muted small folder-empty">Trống. Kéo ghi chú vào đây.</li>}
                </ul>
              )}
            </li>
          );
        })}
        {dragKey && draggedFolder !== null && (
          <li className={"drop-root" + (over === "root" ? " drop-over" : "")}>⤓ Thả vào đây để đưa ra ngoài thư mục</li>
        )}
        {rootNotes.map((n) => noteRow(n, false))}
      </ul>
    </div>
  );
}

function SearchPanel({ notes, api, online, onOpenKey, onOpenId }: {
  notes: LocalNote[]; api: HttpApi; online: boolean; onOpenKey: (k: string) => void; onOpenId: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [remote, setRemote] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const local = useMemo(() => searchNotes(notes, q), [notes, q]);

  useEffect(() => {
    if (!semantic || q.trim().length < 2) {
      setRemote(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.search(q.trim(), 10)
        .then((r) => { if (!cancelled) { setRemote(r); setError(null); } })
        .catch(() => { if (!cancelled) setError("Cần kết nối máy chủ để tìm theo ngữ nghĩa."); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, semantic, api]);

  return (
    <div className="panel">
      <input className="search-input" placeholder="Tìm trong ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <label className="check">
        <input type="checkbox" checked={semantic} disabled={!online} onChange={(e) => setSemantic(e.target.checked)} />
        Tìm theo ngữ nghĩa (AI){!online && " — cần mạng"}
      </label>
      {error && <div className="form-error">{error}</div>}
      {!semantic && (
        <ul className="result-list">
          {local.map((h) => (
            <li key={h.note.key}>
              <button className="result" onClick={() => onOpenKey(h.note.key)}>
                <div className="result-title">{icon(h.note)} {h.note.title}</div>
                <div className="result-snippet">{h.snippet}</div>
              </button>
            </li>
          ))}
          {q.trim() && local.length === 0 && <li className="muted pad">Không tìm thấy.</li>}
        </ul>
      )}
      {semantic && (
        <ul className="result-list">
          {(remote ?? []).map((h) => (
            <li key={h.chunk_id}>
              <button className="result" onClick={() => onOpenId(h.note_id)}>
                <div className="result-title">{h.title}{h.heading ? ` › ${h.heading}` : ""} <span className="badge">{Math.round(h.score * 100)}%</span></div>
                <div className="result-snippet">{h.snippet}</div>
              </button>
            </li>
          ))}
          {remote && remote.length === 0 && <li className="muted pad">Không có kết quả.</li>}
        </ul>
      )}
    </div>
  );
}

// ================================================================== THANH BÊN PHẢI
export interface ChatMsg {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  sources?: ChatSource[];
}

interface RightProps {
  tab: RightTab;
  setTab: (t: RightTab) => void;
  note: LocalNote | null;
  notes: LocalNote[];
  linkIndex: LinkIndex;
  api: HttpApi;
  online: boolean;
  keyById: (id: number) => string | null;
  onOpenKey: (key: string) => void;
  onOpenId: (id: number) => void;
  onCreateTitle: (title: string) => void;
  outline: OutlineItem[];
  onJump: (line: number) => void;
  chat: { messages: ChatMsg[]; busy: boolean; useGraph: boolean; setUseGraph: (b: boolean) => void; onAsk: (q: string) => void; onClear: () => void };
}

export function RightSidebar(p: RightProps) {
  return (
    <aside className="sidebar right">
      <div className="side-tabs" role="tablist">
        {(["links", "outline", "chat"] as RightTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? "active" : ""} onClick={() => p.setTab(t)}>
            {t === "links" ? "Liên kết" : t === "outline" ? "Dàn ý" : "Hỏi đáp"}
          </button>
        ))}
      </div>
      {p.tab === "links" && <LinksPanel {...p} />}
      {p.tab === "outline" && (
        <div className="panel">
          {!p.note && <div className="muted pad">Mở một ghi chú để xem dàn ý.</div>}
          {p.note && p.outline.length === 0 && <div className="muted pad">Ghi chú chưa có tiêu đề (#, ##…).</div>}
          {p.outline.map((o, i) => (
            <button key={i} className="row outline" style={{ paddingLeft: 8 + (o.level - 1) * 14 }} onClick={() => p.onJump(o.line)}>{o.text}</button>
          ))}
        </div>
      )}
      {p.tab === "chat" && <ChatPanel {...p.chat} online={p.online} onOpenId={p.onOpenId} />}
    </aside>
  );
}

function LinksPanel(p: RightProps) {
  const { note } = p;
  const byKey = useMemo(() => new Map(p.notes.map((n) => [n.key, n])), [p.notes]);
  const [items, setItems] = useState<RelatedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!note || note.id === null || note.status !== "ready" || !p.online) {
      setItems(null);
      return;
    }
    let cancelled = false;
    p.api.related(note.id)
      .then((r) => { if (!cancelled) { setItems(r.filter((x) => x.semantic_score !== null)); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [note?.id, note?.status, note?.base_version, p.online, p.api]);

  if (!note) return <div className="panel"><div className="muted pad">Mở một ghi chú để xem các liên kết của nó.</div></div>;

  const back = (p.linkIndex.backlinks.get(note.key) ?? []).map((k) => byKey.get(k)).filter((x): x is LocalNote => !!x);
  const out = p.linkIndex.outgoing.get(note.key) ?? [];
  const resolved = out.filter((o) => o.key !== null).map((o) => byKey.get(o.key as string)).filter((x): x is LocalNote => !!x);
  const unresolved = [...new Set(out.filter((o) => o.key === null).map((o) => o.title))];

  const semanticMsg = note.id === null ? "Ghi chú chưa đồng bộ lên máy chủ."
    : note.status === "failed" ? "Lập chỉ mục lỗi."
    : note.status !== "ready" ? "Đang lập chỉ mục… sẽ có gợi ý trong giây lát."
    : !p.online ? "Cần kết nối để xem gợi ý."
    : failed ? "Không tải được gợi ý."
    : items === null ? "Đang tải…"
    : items.length === 0 ? "Chưa có ghi chú nào đủ giống." : null;

  return (
    <div className="panel">
      <h4>Liên kết đến ({back.length})</h4>
      {back.length === 0 && <div className="muted pad small">Chưa có ghi chú nào trỏ tới đây bằng [[{note.title}]].</div>}
      {back.map((n) => <button key={n.key} className="row" onClick={() => p.onOpenKey(n.key)}>{icon(n)} {n.title}</button>)}

      <h4>Liên kết đi ({resolved.length})</h4>
      {resolved.length === 0 && <div className="muted pad small">Ghi chú này chưa liên kết tới ghi chú nào.</div>}
      {resolved.map((n) => <button key={n.key} className="row" onClick={() => p.onOpenKey(n.key)}>{icon(n)} {n.title}</button>)}

      {unresolved.length > 0 && <h4>Chưa có ghi chú ({unresolved.length})</h4>}
      {unresolved.map((t) => <button key={t} className="row unresolved" onClick={() => p.onCreateTitle(t)} title="Bấm để tạo">＋ {t}</button>)}

      <h4>Gợi ý liên quan (AI)</h4>
      {semanticMsg && <div className="muted pad small">{semanticMsg}</div>}
      {items?.map((r) => {
        const key = p.keyById(r.note_id);
        return (
          <button key={r.note_id} className="row" onClick={() => (key ? p.onOpenKey(key) : p.onOpenId(r.note_id))}>
            <span>{r.title}</span><span className="badge">{Math.round((r.semantic_score ?? 0) * 100)}%</span>
          </button>
        );
      })}
    </div>
  );
}

function ChatPanel({ messages, busy, useGraph, setUseGraph, onAsk, onClear, online, onOpenId }: RightProps["chat"] & {
  online: boolean; onOpenId: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const send = () => {
    const text = q.trim();
    if (!text || busy) return;
    onAsk(text);
    setQ("");
  };

  return (
    <div className="panel chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted pad">Hỏi bất kỳ điều gì về ghi chú của bạn. Câu trả lời chỉ dựa trên ghi chú và có ghi nguồn.</div>}
        {messages.map((m) => (
          <div key={m.id} className={"msg " + m.role}>
            <div className="msg-text">{m.text}</div>
            {m.sources && m.sources.length > 0 && (
              <div className="sources">
                {m.sources.map((s) => (
                  <button key={s.chunk_id} className="source" onClick={() => onOpenId(s.note_id)} title={s.snippet}>
                    [{s.n}] {s.title}{s.heading ? ` › ${s.heading}` : ""}{s.via === "graph" ? " 🕸" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="msg-text muted">Đang suy nghĩ…</div></div>}
      </div>
      <label className="check small">
        <input type="checkbox" checked={useGraph} onChange={(e) => setUseGraph(e.target.checked)} />
        Bổ sung ngữ cảnh từ liên kết (thử nghiệm)
      </label>
      <div className="chat-input">
        <textarea value={q} rows={2} placeholder={online ? "Đặt câu hỏi… (Enter để gửi)" : "Cần kết nối để hỏi đáp"} disabled={!online}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="chat-buttons">
          <button className="primary" onClick={send} disabled={busy || !online || !q.trim()}>Gửi</button>
          <button onClick={onClear} disabled={messages.length === 0}>Xóa</button>
        </div>
      </div>
    </div>
  );
}
