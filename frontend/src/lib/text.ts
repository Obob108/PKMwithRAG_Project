// Hàm xử lý văn bản thuần (không phụ thuộc React): tìm kiếm, liên kết [[wiki]], thẻ, dàn ý.

/** Bỏ dấu tiếng Việt, hạ chữ thường: "Kế hoạch" -> "ke hoach". */
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

const WIKI_RE = /\[\[([^\[\]|#]+?)(?:[#|][^\[\]]*)?\]\]/g; // cùng quy tắc với backend

export function extractWikiLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIKI_RE)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function* visibleLines(text: string): Generator<[string, number]> {
  let fence: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(```+|~~~+)/);
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      continue;
    }
    if (fence === null) yield [lines[i], i];
  }
}

export function extractTags(text: string): string[] {
  const out: string[] = [];
  const re = /(^|[\s(])#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/gu;
  for (const [line] of visibleLines(text)) {
    if (/^#{1,6}\s/.test(line)) continue; // tiêu đề, không phải thẻ
    for (const m of line.matchAll(re)) if (!out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

export function extractOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const [line, i] of visibleLines(text)) {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m && m[2]) out.push({ level: m[1].length, text: m[2], line: i });
  }
  return out;
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** Điểm khớp mờ (subsequence, bỏ dấu); null = không khớp. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, "");
  const t = fold(text);
  if (!q) return 0;
  let from = 0;
  let prev = -2;
  let score = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, from);
    if (idx < 0) return null;
    score += 1;
    if (idx === prev + 1) score += 3;
    if (idx === 0 || /[\s\-_/.]/.test(t[idx - 1])) score += 2;
    prev = idx;
    from = idx + 1;
  }
  if (t.includes(q)) score += 10;
  if (t.startsWith(q)) score += 5;
  return score - t.length * 0.01;
}

export function fuzzyFilter<T>(items: T[], query: string, getText: (x: T) => string, limit = 50): T[] {
  const scored: [T, number][] = [];
  for (const it of items) {
    const s = fuzzyScore(query, getText(it));
    if (s !== null) scored.push([it, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map((x) => x[0]);
}

export interface SearchHit<T> {
  note: T;
  snippet: string;
  score: number;
}

/** Tìm theo từ khóa (không phân biệt dấu/hoa-thường) trong tiêu đề và nội dung. Mọi từ đều phải có mặt. */
export function searchNotes<T extends { title: string; content: string }>(
  notes: T[], query: string, limit = 50,
): SearchHit<T>[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit<T>[] = [];
  for (const note of notes) {
    const title = fold(note.title);
    const raw = note.content.normalize("NFC");
    const body = fold(raw);
    if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
    let score = 0;
    for (const t of terms) score += (title.includes(t) ? 10 : 0) + (body.includes(t) ? 1 : 0);
    const first = terms.map((t) => body.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    let snippet = "";
    if (first !== undefined) {
      const start = Math.max(0, first - 40);
      snippet = (start > 0 ? "…" : "") + raw.slice(start, first + 100).replace(/\s+/g, " ").trim();
    } else {
      snippet = raw.slice(0, 120).replace(/\s+/g, " ").trim();
    }
    hits.push({ note, snippet, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export interface LinkIndex {
  titleToKey: Map<string, string>;
  outgoing: Map<string, { title: string; key: string | null }[]>;
  backlinks: Map<string, string[]>;
}

/** Chỉ số liên kết [[wiki]] tính ngay trên máy (hoạt động cả khi ngoại tuyến), khớp tiêu đề không phân biệt hoa-thường/dấu. */
export function buildLinkIndex(notes: { key: string; title: string; content: string }[]): LinkIndex {
  const titleToKey = new Map<string, string>();
  for (const n of notes) if (!titleToKey.has(fold(n.title))) titleToKey.set(fold(n.title), n.key);
  const outgoing = new Map<string, { title: string; key: string | null }[]>();
  const backlinks = new Map<string, string[]>();
  for (const n of notes) {
    const out = extractWikiLinks(n.content).map((title) => ({ title, key: titleToKey.get(fold(title)) ?? null }));
    outgoing.set(n.key, out);
    for (const l of out) {
      if (l.key === null || l.key === n.key) continue;
      const arr = backlinks.get(l.key) ?? [];
      if (!arr.includes(n.key)) arr.push(n.key);
      backlinks.set(l.key, arr);
    }
  }
  return { titleToKey, outgoing, backlinks };
}
