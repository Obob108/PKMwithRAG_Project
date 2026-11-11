import { createElement, useMemo } from "react";
import type { ReactNode } from "react";
import { parseMarkdown } from "../lib/markdown.ts";
import type { Block, Inline } from "../lib/markdown.ts";

interface Props {
  text: string;
  /** Bấm vào [[liên kết]]. */
  onWikiLink: (target: string) => void;
  /** [[liên kết]] có ghi chú đích chưa (để tô khác màu khi chưa có). */
  exists: (target: string) => boolean;
  onTag?: (tag: string) => void;
}

export default function Markdown({ text, onWikiLink, exists, onTag }: Props) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  const inline = (items: Inline[]): ReactNode[] =>
    items.map((it, i) => {
      switch (it.t) {
        case "text":
          return it.s;
        case "code":
          return <code key={i}>{it.s}</code>;
        case "strong":
          return <strong key={i}>{inline(it.c)}</strong>;
        case "em":
          return <em key={i}>{inline(it.c)}</em>;
        case "del":
          return <del key={i}>{inline(it.c)}</del>;
        case "link":
          return <a key={i} href={it.href} target="_blank" rel="noopener noreferrer">{inline(it.c)}</a>;
        case "wiki":
          return (
            <a key={i} href="#" className={exists(it.target) ? "wikilink" : "wikilink unresolved"}
               title={exists(it.target) ? it.target : `${it.target} (chưa có, bấm để tạo)`}
               onClick={(e) => { e.preventDefault(); onWikiLink(it.target); }}>
              {it.alias}
            </a>
          );
        case "tag":
          return (
            <a key={i} href="#" className="tag" onClick={(e) => { e.preventDefault(); onTag?.(it.tag); }}>#{it.tag}</a>
          );
      }
    });

  const block = (b: Block, i: number): ReactNode => {
    switch (b.t) {
      case "heading":
        return createElement(`h${b.level}`, { key: i, "data-line": b.line }, inline(b.c));
      case "p":
        return <p key={i}>{inline(b.c)}</p>;
      case "code":
        return <pre key={i}><code>{b.s}</code></pre>;
      case "hr":
        return <hr key={i} />;
      case "quote":
        return <blockquote key={i}>{b.c.map(block)}</blockquote>;
      case "callout":
        return (
          <div key={i} className={`callout callout-${b.kind}`}>
            <div className="callout-title">{inline(b.title)}</div>
            {b.c.map(block)}
          </div>
        );
      case "list": {
        const items = b.items.map((it, k) => (
          <li key={k} className={it.checked === null ? undefined : "task"}>
            {it.checked !== null && <input type="checkbox" checked={it.checked} readOnly disabled />}
            {inline(it.c)}
            {it.children.map(block)}
          </li>
        ));
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case "table":
        return (
          <div key={i} className="table-wrap">
            <table>
              <thead>
                <tr>{b.head.map((c, k) => <th key={k} style={{ textAlign: b.align[k] ?? undefined }}>{inline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, k) => <td key={k} style={{ textAlign: b.align[k] ?? undefined }}>{inline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };

  return <div className="md">{blocks.map(block)}</div>;
}
