// Bộ phân tích Markdown nhỏ, an toàn: sinh cây AST (React dựng phần tử, KHÔNG dùng innerHTML nên không có XSS).
// Hỗ trợ: tiêu đề, đoạn, danh sách (lồng nhau, đánh số, việc cần làm), trích dẫn + callout kiểu Obsidian, khối code,
// bảng, đường kẻ, đậm/nghiêng/gạch ngang/mã, liên kết http(s)/mailto, [[wiki-link]], #thẻ.

export type Inline =
  | { t: "text"; s: string }
  | { t: "code"; s: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "wiki"; target: string; alias: string }
  | { t: "tag"; tag: string };

export interface ListItem {
  checked: boolean | null;
  c: Inline[];
  children: Block[];
}

export type Block =
  | { t: "heading"; level: number; c: Inline[]; line: number }
  | { t: "p"; c: Inline[] }
  | { t: "code"; lang: string; s: string }
  | { t: "hr" }
  | { t: "quote"; c: Block[] }
  | { t: "callout"; kind: string; title: Inline[]; c: Block[] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][]; align: ("left" | "right" | "center" | null)[] };

const ALNUM = /[\p{L}\p{N}]/u;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push({ t: "text", s: buf });
    buf = "";
  };
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);
    let m: RegExpMatchArray | null;
    if (ch === "\\" && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!~|>]/.test(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`" && (m = rest.match(/^`([^`\n]+)`/))) {
      flush();
      out.push({ t: "code", s: m[1] });
      i += m[0].length;
      continue;
    }
    if (ch === "[") {
      if ((m = rest.match(/^\[\[([^\[\]|#\n]+?)(?:#[^\[\]|\n]*)?(?:\|([^\[\]\n]+))?\]\]/))) {
        flush();
        out.push({ t: "wiki", target: m[1].trim(), alias: (m[2] ?? m[1]).trim() });
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/))) {
        flush();
        out.push({ t: "link", href: m[2], c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const prev = i > 0 ? text[i - 1] : "";
      const okStart = ch === "*" || !ALNUM.test(prev);
      const after = (len: number) => (i + len < text.length ? text[i + len] : "");
      if (okStart && (m = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/)) && (ch === "*" || !ALNUM.test(after(m[0].length - 0) ))) {
        flush();
        out.push({ t: "strong", c: parseInline(m[2]) });
        i += m[0].length;
        continue;
      }
      if (okStart && (m = rest.match(/^(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\1/)) && (ch === "*" || !ALNUM.test(after(m[0].length)))) {
        flush();
        out.push({ t: "em", c: parseInline(m[2]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "~" && (m = rest.match(/^~~(?=\S)([\s\S]*?\S)~~/))) {
      flush();
      out.push({ t: "del", c: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (ch === "#" && (i === 0 || /[\s(]/.test(text[i - 1])) &&
        (m = rest.match(/^#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/u))) {
      flush();
      out.push({ t: "tag", tag: m[1] });
      i += m[0].length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l) ||
    (l.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]));
}

function indentOf(l: string): number {
  return l.match(/^\s*/)![0].replace(/\t/g, "    ").length;
}

function parseList(lines: string[]): Block {
  const first = lines[0].match(LIST_RE)!;
  const base = indentOf(lines[0]);
  const ordered = /\d/.test(first[2]);
  const items: { head: string; sub: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(LIST_RE);
    if (m && indentOf(line) <= base + 1) items.push({ head: m[3], sub: [] });
    else if (items.length) items[items.length - 1].sub.push(line);
  }
  return {
    t: "list",
    ordered,
    items: items.map(({ head, sub }) => {
      let checked: boolean | null = null;
      const task = head.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        checked = task[1] !== " ";
        head = task[2];
      }
      const nonBlank = sub.filter((l) => l.trim());
      const cut = nonBlank.length ? Math.min(...nonBlank.map(indentOf)) : 0;
      const dedented = sub.map((l) => l.replace(new RegExp(`^\\s{0,${cut}}`), ""));
      return { checked, c: parseInline(head), children: parseBlocks(dedented, 0) };
    }),
  };
}

export function parseBlocks(lines: string[], lineOffset: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(FENCE_RE))) {
      const fence = m[2];
      const lang = m[3].trim().split(/\s+/)[0] ?? "";
      const body: string[] = [];
      i++;
      const closer = new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      while (i < lines.length && !closer.test(lines[i])) body.push(lines[i++]);
      i++; // dòng đóng (nếu có)
      blocks.push({ t: "code", lang, s: body.join("\n") });
      continue;
    }
    if ((m = line.match(HEADING_RE))) {
      blocks.push({ t: "heading", level: m[1].length, c: parseInline(m[2]), line: lineOffset + i });
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      const co = inner[0].match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (co) blocks.push({ t: "callout", kind: co[1].toLowerCase(), title: parseInline(co[2] || co[1]), c: parseBlocks(inner.slice(1), 0) });
      else blocks.push({ t: "quote", c: parseBlocks(inner, 0) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null) as
        ("left" | "right" | "center" | null)[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ t: "table", head: head.map(parseInline), rows: rows.map((r) => r.map(parseInline)), align });
      continue;
    }
    if (LIST_RE.test(line)) {
      const group: string[] = [];
      const base = indentOf(line);
      const ordered = /\d/.test(line.match(LIST_RE)![2]);
      // Đổi kiểu danh sách (gạch đầu dòng <-> đánh số) ở cùng cấp thì bắt đầu danh sách mới.
      const switches = (l: string) => {
        const lm = l.match(LIST_RE);
        return !!lm && indentOf(l) <= base + 1 && /\d/.test(lm[2]) !== ordered;
      };
      while (i < lines.length) {
        const l = lines[i];
        if (switches(l)) break;
        if (LIST_RE.test(l) || (l.trim() && /^\s{2,}\S/.test(l))) group.push(l);
        else if (!l.trim() && i + 1 < lines.length && !switches(lines[i + 1]) &&
                 (LIST_RE.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) group.push(l);
        else break;
        i++;
      }
      blocks.push(parseList(group));
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) para.push(lines[i++]);
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}
