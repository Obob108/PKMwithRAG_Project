import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Markdown from "./Markdown.tsx";
import type { SyncEngine } from "../lib/engine.ts";
import { resolveConflicts } from "../lib/merge.ts";
import { fuzzyFilter } from "../lib/text.ts";
import type { LocalNote } from "../lib/types.ts";
import type { Mode } from "../lib/ui.ts";

interface Props {
  note: LocalNote;
  engine: SyncEngine;
  notes: LocalNote[];
  mode: Mode;
  setMode: (m: Mode) => void;
  fontSize: number;
  exists: (title: string) => boolean;
  onOpenTitle: (title: string) => void;
  onOpenPdf: (key: string) => void;
  onDelete: (key: string) => void;
  onRenamed: (key: string, oldTitle: string, newTitle: string) => void;
  onTag: (tag: string) => void;
  jump: { line: number; nonce: number } | null;
}

interface Autocomplete {
  start: number; // vị trí bắt đầu phần đang gõ sau "[["
  items: string[];
  index: number;
}

export default function EditorPane(p: Props) {
  const { note, engine } = p;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const titleAtFocus = useRef(note.title);
  const lastLocal = useRef(note.content);
  const [text, setText] = useState(note.content);
  const [ac, setAc] = useState<Autocomplete | null>(null);

  // Bản sao cục bộ giúp con trỏ không nhảy khi gõ; chỉ nhận nội dung từ ngoài khi nó khác bản vừa gõ.
  useEffect(() => {
    if (note.content !== lastLocal.current) {
      lastLocal.current = note.content;
      setText(note.content);
    }
  }, [note.content]);

  const commit = (value: string) => {
    lastLocal.current = value;
    setText(value);
    engine.edit(note.key, { content: value });
  };

  const select = (from: number, to: number) => {
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(from, to);
      }
    });
  };

  // ---------------------------------------------------------------- định dạng
  const wrap = (before: string, after = before, placeholder = "") => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    commit(value.slice(0, s) + before + sel + after + value.slice(e));
    select(s + before.length, s + before.length + sel.length);
  };

  const prefixLines = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const v = ta.value;
    const ls = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let le = v.indexOf("\n", ta.selectionEnd);
    if (le === -1) le = v.length;
    const lines = v.slice(ls, le).split("\n");
    const allHave = lines.every((l) => l.startsWith(prefix));
    const out = lines.map((l) => (allHave ? l.slice(prefix.length) : prefix + l)).join("\n");
    commit(v.slice(0, ls) + out + v.slice(le));
    select(ls, ls + out.length);
  };

  // ---------------------------------------------------------------- gợi ý [[liên kết]]
  const refreshAc = (value: string, caret: number) => {
    const m = value.slice(0, caret).match(/\[\[([^\[\]\n]*)$/);
    if (!m) {
      setAc(null);
      return;
    }
    const items = fuzzyFilter(p.notes.filter((n) => n.key !== note.key), m[1], (n) => n.title, 8).map((n) => n.title);
    setAc(items.length ? { start: caret - m[1].length, items, index: 0 } : null);
  };

  const accept = (title: string) => {
    const ta = taRef.current;
    if (!ta || !ac) return;
    const caret = ta.selectionStart;
    const after = ta.value.slice(caret);
    const next = ta.value.slice(0, ac.start) + title + "]]" + (after.startsWith("]]") ? after.slice(2) : after);
    commit(next);
    setAc(null);
    const pos = ac.start + title.length + 2;
    select(pos, pos);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setAc({ ...ac, index: (ac.index + d + ac.items.length) % ac.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(ac.items[ac.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === "b") { e.preventDefault(); wrap("**", "**", "đậm"); }
      else if (e.key === "i") { e.preventDefault(); wrap("*", "*", "nghiêng"); }
      else if (e.key === "k") { e.preventDefault(); wrap("[[", "]]", "ghi chú"); }
    }
  };

  // ---------------------------------------------------------------- nhảy tới dòng (từ Dàn ý)
  useEffect(() => {
    if (!p.jump) return;
    const ta = taRef.current;
    if (ta && p.mode !== "read") {
      const lines = ta.value.split("\n");
      let off = 0;
      for (let i = 0; i < Math.min(p.jump.line, lines.length); i++) off += lines[i].length + 1;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || p.fontSize * 1.6;
      ta.focus();
      ta.setSelectionRange(off, off);
      ta.scrollTop = Math.max(0, p.jump.line * lh - 40);
    }
    readRef.current?.querySelector(`[data-line="${p.jump.line}"]`)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.jump?.nonce]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${note.title || "ghi-chu"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitTitle = () => {
    const old = titleAtFocus.current;
    if (!note.title.trim()) {
      engine.edit(note.key, { title: old });
      return;
    }
    if (note.title !== old) p.onRenamed(note.key, old, note.title);
    titleAtFocus.current = note.title;
  };

  const showEdit = p.mode !== "read";
  const showRead = p.mode !== "edit";

  return (
    <div className="editor-pane">
      <div className="pane-toolbar">
        <input className="title-input" value={note.title} placeholder="Tiêu đề ghi chú"
               onFocus={() => { titleAtFocus.current = note.title; }}
               onChange={(e) => engine.edit(note.key, { title: e.target.value })}
               onBlur={commitTitle}
               onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        <div className="seg" role="group" aria-label="Chế độ">
          <button className={p.mode === "edit" ? "active" : ""} title="Chỉnh sửa" onClick={() => p.setMode("edit")}>✎</button>
          <button className={p.mode === "split" ? "active" : ""} title="Chia đôi" onClick={() => p.setMode("split")}>◫</button>
          <button className={p.mode === "read" ? "active" : ""} title="Xem (Ctrl+E)" onClick={() => p.setMode("read")}>👁</button>
        </div>
        {note.source === "pdf" && (
          <button onClick={() => p.onOpenPdf(note.key)} disabled={!note.has_file}
                  title={note.has_file ? "Mở file PDF gốc" : "Không có file PDF gốc"}>📕 PDF gốc</button>
        )}
        <button onClick={download} title="Tải về .md">⬇</button>
        <button className="danger" title="Xóa ghi chú" onClick={() => { if (confirm(`Xóa ghi chú “${note.title}”?`)) p.onDelete(note.key); }}>🗑</button>
      </div>

      {note.has_conflict && (
        <div className="banner warn">
          <div>
            <b>⚠ Xung đột khi gộp.</b> Hai thiết bị cùng sửa một đoạn nên cả hai bản đang nằm trong các khối{" "}
            <code>{"<<<<<<<"}</code> … <code>{">>>>>>>"}</code>. Chọn cách giữ, hoặc tự sửa tay rồi xóa các dòng đánh dấu.
          </div>
          <div className="banner-actions">
            <button onClick={() => commit(resolveConflicts(text, "server"))}>Giữ bản máy chủ</button>
            <button onClick={() => commit(resolveConflicts(text, "mine"))}>Giữ bản của tôi</button>
            <button onClick={() => commit(resolveConflicts(text, "both"))}>Giữ cả hai</button>
          </div>
        </div>
      )}

      {showEdit && (
        <div className="format-bar">
          <button title="Đậm (Ctrl+B)" onClick={() => wrap("**", "**", "đậm")}><b>B</b></button>
          <button title="Nghiêng (Ctrl+I)" onClick={() => wrap("*", "*", "nghiêng")}><i>I</i></button>
          <button title="Gạch ngang" onClick={() => wrap("~~", "~~", "văn bản")}><s>S</s></button>
          <button title="Mã" onClick={() => wrap("`", "`", "mã")}>{"</>"}</button>
          <button title="Tiêu đề" onClick={() => prefixLines("# ")}>H</button>
          <button title="Danh sách" onClick={() => prefixLines("- ")}>•</button>
          <button title="Việc cần làm" onClick={() => prefixLines("- [ ] ")}>☑</button>
          <button title="Trích dẫn" onClick={() => prefixLines("> ")}>❝</button>
          <button title="Liên kết web" onClick={() => wrap("[", "](https://)", "văn bản")}>🔗</button>
          <button title="Liên kết ghi chú [[ ]] (Ctrl+K)" onClick={() => wrap("[[", "]]", "ghi chú")}>[[ ]]</button>
        </div>
      )}

      <div className={"editor-body " + p.mode}>
        {showEdit && (
          <div className="edit-wrap">
            <textarea ref={taRef} className="editor" value={text} spellCheck={false} style={{ fontSize: p.fontSize }}
                      placeholder="Bắt đầu viết… Dùng [[ để liên kết tới ghi chú khác, #thẻ để gắn thẻ."
                      onChange={(e) => { commit(e.target.value); refreshAc(e.target.value, e.target.selectionStart); }}
                      onKeyDown={onKeyDown}
                      onClick={(e) => refreshAc(e.currentTarget.value, e.currentTarget.selectionStart)}
                      onBlur={() => setTimeout(() => setAc(null), 150)} />
            {ac && (
              <ul className="ac-list" role="listbox">
                {ac.items.map((t, i) => (
                  <li key={t} role="option" aria-selected={i === ac.index} className={i === ac.index ? "active" : ""}
                      onMouseDown={(e) => { e.preventDefault(); accept(t); }}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {showRead && (
          <div className="read-pane" ref={readRef} style={{ fontSize: p.fontSize }}>
            <Markdown text={text} exists={p.exists} onWikiLink={p.onOpenTitle} onTag={p.onTag} />
          </div>
        )}
      </div>
    </div>
  );
}
