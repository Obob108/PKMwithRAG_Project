import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "../src/lib/markdown.ts";
import { extractWikiLinks } from "../src/lib/text.ts";

const kinds = (s: string) => parseInline(s).map((x) => x.t);

test("công thức trong dòng $...$", () => {
  const r = parseInline("Hàm mất mát $L = -\\sum y \\log \\hat{y}$ nhé");
  assert.deepEqual(r.map((x) => x.t), ["text", "math", "text"]);
  assert.equal((r[1] as { tex: string }).tex, "L = -\\sum y \\log \\hat{y}");
});

test("tiền tệ và dấu $ lẻ không bị hiểu nhầm thành công thức", () => {
  assert.deepEqual(kinds("giá $5 và $10"), ["text"]);
  assert.deepEqual(kinds("tôi có $ 5 và 6 $"), ["text"]);
  assert.deepEqual(kinds("thoát \\$x\\$ bằng gạch chéo"), ["text"]);
  assert.deepEqual(kinds("trong code `$x$` thì không"), ["text", "code", "text"]);
});

test("khối $$...$$ nhiều dòng, một dòng, và thiếu dấu đóng", () => {
  const b = parseMarkdown("Trước\n\n$$\n\\frac{a}{b}\n= c\n$$\n\nSau");
  assert.deepEqual(b.map((x) => x.t), ["p", "math", "p"]);
  assert.equal((b[1] as { tex: string }).tex, "\\frac{a}{b}\n= c");
  assert.deepEqual(parseMarkdown("$$ x^2 $$").map((x) => x.t), ["math"]);
  const open = parseMarkdown("$$\nchưa đóng\n\n# Tiêu đề");
  assert.deepEqual(open.map((x) => x.t), ["p", "p", "heading"]);
  // $$ trong khối code không phải công thức
  assert.deepEqual(parseMarkdown("```\n$$\nx\n$$\n```").map((x) => x.t), ["code"]);
});

test("ảnh: ![[ảnh.png]], có độ rộng, ảnh web; ![[Ghi chú]] không phải ảnh", () => {
  const r = parseInline("xem ![[Pasted image 20261120172700.png]] và ![[a.jpg|300]] và ![mèo](https://x.org/m.webp)");
  const imgs = r.filter((x) => x.t === "image") as { name: string | null; src: string | null; width: number | null }[];
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0].name, "Pasted image 20261120172700.png");
  assert.equal(imgs[1].width, 300);
  assert.equal(imgs[2].src, "https://x.org/m.webp");
  assert.ok(!kinds("![[Ghi chú khác]]").includes("image"));
  assert.ok(!kinds("![x](javascript:alert(1))").includes("image")); // chỉ nhận http(s)
});

test("ảnh nhúng không bị tính là liên kết [[...]] tới ghi chú", () => {
  assert.deepEqual(extractWikiLinks("![[Pasted image 1.png]] và [[RAG]] và ![[Ghi chú nhúng]]"), ["RAG", "Ghi chú nhúng"]);
});
