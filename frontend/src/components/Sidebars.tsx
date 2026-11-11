import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSource, HttpApi, RelatedItem, SearchHit } from "../lib/api.ts";
import { searchNotes } from "../lib/text.ts";
import type { LinkIndex, OutlineItem } from "../lib/text.ts";
import type { LocalNote } from "../lib/types.ts";
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
  onNew: () => void;
  onUpload: () => void;
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

function FilesPanel(p: LeftProps) {
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const list = useMemo(() => {
    let l = p.tagFilter ? p.notes.filter((n) => p.noteTags.get(n.key)?.includes(p.tagFilter as string)) : p.notes;
    if (sort === "name") l = [...l].sort((a, b) => a.title.localeCompare(b.title, "vi"));
    return l;
  }, [p.notes, p.tagFilter, p.noteTags, sort]);
  return (
    <div className="panel">
      <div className="panel-actions">
        <button onClick={p.onNew} title="Ghi chú mới">✚ Mới</button>
        <button onClick={p.onUpload} title="Tải lên .md / .pdf">⬆ Tải lên</button>
        <button onClick={() => setSort(sort === "recent" ? "name" : "recent")} title="Đổi cách sắp xếp">
          {sort === "recent" ? "⏱ Mới nhất" : "A–Z"}
        </button>
      </div>
      {p.tagFilter && (
        <div className="chip-row">
          <span className="chip">#{p.tagFilter} <button aria-label="Bỏ lọc" onClick={() => p.setTagFilter(null)}>×</button></span>
        </div>
      )}
      {list.length === 0 && <div className="muted pad">{p.notes.length === 0 ? "Chưa có ghi chú. Bấm “✚ Mới” hoặc tải lên file." : "Không có ghi chú phù hợp."}</div>}
      <ul className="file-list">
        {list.map((n) => (
          <li key={n.key}>
            <button className={"file-item" + (n.key === p.activeKey ? " active" : "")} onClick={() => p.onOpenKey(n.key)} title={n.title}>
              <span className="file-icon">{icon(n)}</span>
              <span className="file-title">{n.title || "Chưa đặt tên"}</span>
              {n.has_conflict && <span title="Có xung đột">⚠</span>}
              {(n.dirty || n.id === null) && <span className="dot" title="Chưa đồng bộ" />}
            </button>
          </li>
        ))}
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
