import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkIndex, extractOutline, extractTags, extractWikiLinks, fold, fuzzyFilter, fuzzyScore, searchNotes, wordCount,
} from "../src/lib/text.ts";

test("fold removes Vietnamese diacritics", () => {
  assert.equal(fold("Kế hoạch ĐỒ ÁN"), "ke hoach do an");
});

test("wiki links: aliases, headings, duplicates", () => {
  assert.deepEqual(extractWikiLinks("Xem [[RAG]] và [[Embedding|vector]], [[RAG]] lại, [[Note#muc]] [[ ]]"), ["RAG", "Embedding", "Note"]);
});

test("tags skip headings and code fences", () => {
  const t = "# Tiêu đề\nCó #rag và #ke-hoach/2026 #123\n```\n#trong-code\n```\nMã C# không phải thẻ";
  assert.deepEqual(extractTags(t), ["rag", "ke-hoach/2026"]);
});

test("outline skips code fences and reports line numbers", () => {
  const o = extractOutline("# A\ntext\n```\n# not heading\n```\n## B ##\n#tag");
  assert.deepEqual(o, [{ level: 1, text: "A", line: 0 }, { level: 2, text: "B", line: 5 }]);
});

test("word count", () => assert.equal(wordCount("  một hai\nba  "), 3));

test("fuzzy matching ignores diacritics and ranks tighter matches first", () => {
  assert.notEqual(fuzzyScore("khc", "Kế hoạch"), null);
  assert.notEqual(fuzzyScore("kehoach", "Kế hoạch"), null);
  assert.equal(fuzzyScore("zzz", "Kế hoạch"), null);
  const r = fuzzyFilter(["Chunking Strategy", "Citations and Grounding", "Chunk"], "chunk", (x) => x);
  assert.deepEqual(r.slice(0, 2).sort(), ["Chunk", "Chunking Strategy"]);
  assert.equal(r.length, 2);
});

test("searchNotes finds by terms in title or body without diacritics and gives snippets", () => {
  const notes = [
    { title: "Kế hoạch", content: "Việc cần làm tuần này: viết báo cáo chương hai" },
    { title: "Khác", content: "không liên quan" },
  ];
  const hits = searchNotes(notes, "ke hoach bao cao");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].note.title, "Kế hoạch");
  assert.ok(hits[0].snippet.includes("báo cáo"));
  assert.deepEqual(searchNotes(notes, "   "), []);
});

test("link index: resolved, unresolved, backlinks, case/diacritic-insensitive titles", () => {
  const notes = [
    { key: "a", title: "RAG", content: "xem [[Kế hoạch]] và [[Chưa có]]" },
    { key: "b", title: "Kế hoạch", content: "về [[rag]] và [[Kế hoạch]]" },
  ];
  const idx = buildLinkIndex(notes);
  assert.deepEqual(idx.outgoing.get("a"), [{ title: "Kế hoạch", key: "b" }, { title: "Chưa có", key: null }]);
  assert.deepEqual(idx.backlinks.get("b"), ["a"]);
  assert.deepEqual(idx.backlinks.get("a"), ["b"]);
  assert.equal(idx.backlinks.get("b")?.includes("b"), false); // tự liên kết không tính
});
