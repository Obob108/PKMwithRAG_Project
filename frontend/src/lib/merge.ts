// Gộp ba chiều theo dòng: bản port của backend/app/services/merge.py (cùng quy tắc, cùng dấu xung đột).
// base = bản gốc chung, ours = bản máy chủ, theirs = bản trên thiết bị.

export const START = "<<<<<<< MÁY CHỦ (bản hiện tại)\n";
export const MID = "=======\n";
export const END = ">>>>>>> THIẾT BỊ CỦA BẠN\n";

export function hasConflictMarkers(text: string): boolean {
  return /^<<<<<<< /m.test(text) && /^=======\s*$/m.test(text) && /^>>>>>>> /m.test(text);
}

const nl = (t: string): string => (t === "" || t.endsWith("\n") ? t : t + "\n");

export function conflictBlock(ours: string, theirs: string): string {
  return START + nl(ours) + MID + nl(theirs) + END;
}

function splitLines(t: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\n") {
      out.push(t.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < t.length) out.push(t.slice(start));
  return out;
}

// m[i] = vị trí dòng o[i] trong x (hoặc null nếu không khớp), theo dãy con chung dài nhất.
function matchMap(o: string[], x: string[]): (number | null)[] {
  const m: (number | null)[] = new Array(o.length).fill(null);
  let p = 0;
  while (p < o.length && p < x.length && o[p] === x[p]) {
    m[p] = p;
    p++;
  }
  let s = 0;
  while (s < o.length - p && s < x.length - p && o[o.length - 1 - s] === x[x.length - 1 - s]) {
    m[o.length - 1 - s] = x.length - 1 - s;
    s++;
  }
  const on = o.length - p - s;
  const xn = x.length - p - s;
  if (on === 0 || xn === 0 || on * xn > 4_000_000) return m; // quá lớn: chỉ giữ đầu/cuối giống nhau
  const w = xn + 1;
  const dp = new Uint32Array((on + 1) * w);
  for (let i = on - 1; i >= 0; i--) {
    for (let j = xn - 1; j >= 0; j--) {
      dp[i * w + j] =
        o[p + i] === x[p + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < on && j < xn) {
    if (o[p + i] === x[p + j]) {
      m[p + i] = p + j;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return m;
}

function mergeInsertions(a: string[], b: string[]): string[] {
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a[p] === b[p]) p++;
  let s = 0;
  while (s < n - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const suffix = s ? a.slice(a.length - s) : [];
  return [...a.slice(0, p), ...a.slice(p, a.length - s), ...b.slice(p, b.length - s), ...suffix];
}

// Cụm thay đổi: o[s:e] bị thay bằng repl.
interface Hunk {
  s: number;
  e: number;
  repl: string[];
}

function hunksOf(o: string[], x: string[], m: (number | null)[]): Hunk[] {
  const hunks: Hunk[] = [];
  let po = -1;
  let px = -1;
  for (let i = 0; i <= o.length; i++) {
    let j: number;
    if (i === o.length) j = x.length;
    else if (m[i] === null) continue;
    else j = m[i] as number;
    if (po + 1 < i || px + 1 < j) hunks.push({ s: po + 1, e: i, repl: x.slice(px + 1, j) });
    po = i;
    px = j;
  }
  return hunks;
}

function overlaps(h: Hunk, S: number, E: number): boolean {
  if (h.s === h.e) return (S < h.s && h.s < E) || (S === E && E === h.s); // chèn thuần túy
  return h.s < E && S < h.e; // chỉ sát cạnh nhau thì KHÔNG chồng lên nhau
}

function applyHunks(hunks: Hunk[], S: number, E: number, o: string[]): string[] {
  const res: string[] = [];
  let p = S;
  for (const h of hunks) {
    res.push(...o.slice(p, h.s), ...h.repl);
    p = h.e;
  }
  res.push(...o.slice(p, E));
  return res;
}

const same = (x: string[], y: string[]): boolean => x.length === y.length && x.every((v, k) => v === y[k]);

const BLOCK_RE = /^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*(?:\n|$)/gm;

/** Giải quyết mọi khối xung đột cùng lúc: giữ bản máy chủ, bản của mình, hoặc cả hai. */
export function resolveConflicts(text: string, choice: "server" | "mine" | "both"): string {
  return text.replace(BLOCK_RE, (_m: string, ours: string, theirs: string) =>
    choice === "server" ? ours : choice === "mine" ? theirs : ours + theirs);
}

export interface MergeResult {
  text: string;
  conflict: boolean;
}

export function mergeText(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { text: ours, conflict: false };
  if (base === ours) return { text: theirs, conflict: false };
  if (base === theirs) return { text: ours, conflict: false };

  const o = splitLines(nl(base));
  const a = splitLines(nl(ours));
  const b = splitLines(nl(theirs));
  const ha = hunksOf(o, a, matchMap(o, a));
  const hb = hunksOf(o, b, matchMap(o, b));
  // Cùng vị trí: chèn trước, rồi đến thay thế; ours (0) trước theirs (1).
  const key = (side: number, h: Hunk): [number, number, number] => [h.s, h.s === h.e ? 0 : 1, side];
  const le = (x: [number, number, number], y: [number, number, number]): boolean =>
    x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] <= y[2];

  const out: string[] = [];
  let conflict = false;
  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < ha.length || j < hb.length) {
    const takeA = j >= hb.length || (i < ha.length && le(key(0, ha[i]), key(1, hb[j])));
    let h: Hunk;
    const ca: Hunk[] = [];
    const cb: Hunk[] = [];
    if (takeA) {
      h = ha[i++];
      ca.push(h);
    } else {
      h = hb[j++];
      cb.push(h);
    }
    let S = h.s;
    let E = h.e;
    let grew = true;
    while (grew) {
      grew = false;
      if (i < ha.length && overlaps(ha[i], S, E)) {
        S = Math.min(S, ha[i].s);
        E = Math.max(E, ha[i].e);
        ca.push(ha[i++]);
        grew = true;
      }
      if (j < hb.length && overlaps(hb[j], S, E)) {
        S = Math.min(S, hb[j].s);
        E = Math.max(E, hb[j].e);
        cb.push(hb[j++]);
        grew = true;
      }
    }
    out.push(...o.slice(pos, S));
    const segO = o.slice(S, E);
    const segA = applyHunks(ca, S, E, o);
    const segB = applyHunks(cb, S, E, o);
    if (cb.length === 0) out.push(...segA);
    else if (ca.length === 0) out.push(...segB);
    else if (same(segA, segB)) out.push(...segA);
    else if (segO.length === 0) out.push(...mergeInsertions(segA, segB));
    else {
      conflict = true;
      out.push(START, ...segA, MID, ...segB, END);
    }
    pos = E;
  }
  out.push(...o.slice(pos));

  let text = out.join("");
  if (!(ours.endsWith("\n") || theirs.endsWith("\n")) && text.endsWith("\n")) text = text.slice(0, -1);
  return { text, conflict };
}
