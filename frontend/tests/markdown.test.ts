import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "../src/lib/markdown.ts";

test("headings carry line numbers; fenced code keeps hashes literal", () => {
  const b = parseMarkdown("# Một\ntext\n```js\n# không phải tiêu đề\nconst a = 1\n```\n## Hai");
  assert.deepEqual(b.map((x) => x.t), ["heading", "p", "code", "heading"]);
  assert.equal((b[0] as any).line, 0);
  assert.equal((b[3] as any).line, 6);
  assert.deepEqual(b[2], { t: "code", lang: "js", s: "# không phải tiêu đề\nconst a = 1" });
});

test("inline: bold, italic, code, strike, links, wiki, tags", () => {
  const r = parseInline("**đậm** và *nghiêng* `mã` ~~xóa~~ [site](https://a.com) [[Ghi chú|bí danh]] #thẻ-1");
  const kinds = r.map((x) => x.t);
  assert.deepEqual(kinds.filter((k) => k !== "text"), ["strong", "em", "code", "del", "link", "wiki", "tag"]);
  const wiki = r.find((x) => x.t === "wiki") as any;
  assert.deepEqual([wiki.target, wiki.alias], ["Ghi chú", "bí danh"]);
});

test("unsafe link schemes stay as plain text", () => {
  const r = parseInline("[bấm](javascript:alert(1))");
  assert.ok(r.every((x) => x.t === "text"));
});

test("snake_case words are not italicised; escapes work", () => {
  assert.deepEqual(parseInline("file_name_here"), [{ t: "text", s: "file_name_here" }]);
  assert.deepEqual(parseInline("\\*không đậm\\*"), [{ t: "text", s: "*không đậm*" }]);
  const r = parseInline("_nghiêng_ ok");
  assert.equal(r[0].t, "em");
});

test("nested and ordered lists, task items", () => {
  const b = parseMarkdown("- a\n  - a1\n  - a2\n- [x] xong\n- [ ] chưa\n\n1. một\n2. hai");
  assert.equal(b.length, 2);
  const ul = b[0] as any;
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 3);
  assert.equal(ul.items[0].children[0].items.length, 2);
  assert.deepEqual([ul.items[1].checked, ul.items[2].checked], [true, false]);
  assert.equal((b[1] as any).ordered, true);
});

test("tables with alignment", () => {
  const b = parseMarkdown("| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |");
  const t = b[0] as any;
  assert.equal(t.t, "table");
  assert.deepEqual(t.align, ["left", "right"]);
  assert.equal(t.rows.length, 2);
});

test("blockquote and callout", () => {
  const b = parseMarkdown("> trích dẫn\n> tiếp\n\n> [!warning] Cẩn thận\n> nội dung");
  assert.equal(b[0].t, "quote");
  const c = b[1] as any;
  assert.equal(c.t, "callout");
  assert.equal(c.kind, "warning");
  assert.equal(c.c.length, 1);
});

test("paragraph breaks at block starts and keeps soft newlines", () => {
  const b = parseMarkdown("dòng 1\ndòng 2\n# Tiêu đề\n---\nđoạn");
  assert.deepEqual(b.map((x) => x.t), ["p", "heading", "hr", "p"]);
  assert.equal((b[0] as any).c[0].s, "dòng 1\ndòng 2");
});

test("hashtag in heading line is not a tag; mid-word hash is text", () => {
  assert.ok(parseInline("C# là ngôn ngữ").every((x) => x.t === "text"));
  assert.equal(parseInline("xem #rag nhé").some((x) => x.t === "tag"), true);
});

test("does not hang or throw on odd input", () => {
  for (const s of ["", "*", "**", "[[", "[[]]", "`", "~~", "| | |\n|---|", "> ", "- ", "1.", "```", "[a](", "_a", "a_"]) {
    assert.doesNotThrow(() => parseMarkdown(s));
  }
});
