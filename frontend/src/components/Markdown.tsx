import { createElement, memo, useEffect, useMemo, useState } from "react";
import katex from "katex";
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
  /** Tải ảnh đính kèm ![[tên.png]] (cần token) -> URL hiển thị được. Không truyền = hiện tên ảnh. */
  loadImage?: (name: string) => Promise<string>;
}

/**
 * Công thức KaTeX. Đầu ra HTML của KaTeX được chèn bằng innerHTML: an toàn vì KaTeX tự thoát ký tự và ở chế độ
 * trust=false không cho \href, \url, \htmlClass... (nội dung ghi chú vẫn không bao giờ đi qua innerHTML).
 */
const MathView = memo(function MathView({ tex, block }: { tex: string; block: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, {
    displayMode: block, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml",
    maxSize: 50, maxExpand: 500,
  }), [tex, block]);
  return block
    ? <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
});

function AttachmentImage({ name, alt, width, load }: {
  name: string; alt: string; width: number | null; load?: (name: string) => Promise<string>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!load) return;
    load(name).then((u) => { if (alive) setSrc(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [name, load]);
  if (failed || !load) return <span className="img-missing" title={name}>🖼 {name}{failed ? " (không tải được)" : ""}</span>;
  if (!src) return <span className="img-loading" style={width ? { width } : undefined}>Đang tải ảnh…</span>;
  return <img className="md-img" src={src} alt={alt} title={name} style={width ? { width } : undefined} loading="lazy" />;
}

export default function Markdown({ text, onWikiLink, exists, onTag, loadImage }: Props) {
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
        case "math":
          return <MathView key={i} tex={it.tex} block={false} />;
        case "image":
          return it.src
            ? <img key={i} className="md-img" src={it.src} alt={it.alt} loading="lazy" referrerPolicy="no-referrer" />
            : <AttachmentImage key={i} name={it.name as string} alt={it.alt} width={it.width} load={loadImage} />;
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
      case "math":
        return <MathView key={i} tex={b.tex} block />;
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
