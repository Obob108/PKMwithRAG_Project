import test from "node:test";
import assert from "node:assert/strict";
import { conflictBlock, hasConflictMarkers, mergeText, resolveConflicts } from "../src/lib/merge.ts";

test("one-sided and identical changes", () => {
  assert.deepEqual(mergeText("a\nb\n", "a\nB\n", "a\nb\n"), { text: "a\nB\n", conflict: false });
  assert.deepEqual(mergeText("a\nb\n", "a\nb\n", "a\nB\n"), { text: "a\nB\n", conflict: false });
  assert.deepEqual(mergeText("a\nb\n", "a\nX\n", "a\nX\n"), { text: "a\nX\n", conflict: false });
});

test("disjoint edits merge cleanly", () => {
  assert.deepEqual(mergeText("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n"), { text: "a\nB\nc\nD\n", conflict: false });
});

test("both append different lines keeps both", () => {
  assert.deepEqual(mergeText("x\n", "x\ny\n", "x\nz\n"), { text: "x\ny\nz\n", conflict: false });
});

test("overlapping insertions are deduplicated", () => {
  assert.deepEqual(mergeText("t\n", "t\n- 3\n", "t\n- 3\n- 4\n"), { text: "t\n- 3\n- 4\n", conflict: false });
});

test("same line edited differently conflicts and keeps both", () => {
  const r = mergeText("a\nb\nc\n", "a\nB1\nc\n", "a\nB2\nc\n");
  assert.equal(r.conflict, true);
  assert.ok(hasConflictMarkers(r.text));
  assert.ok(r.text.startsWith("a\n<<<<<<< "));
  assert.ok(r.text.includes("B1\n=======\nB2\n"));
  assert.ok(r.text.endsWith(">>>>>>> THIẾT BỊ CỦA BẠN\nc\n"));
});

test("delete vs edit conflicts; delete + edit elsewhere merges", () => {
  assert.equal(mergeText("a\nb\nc\n", "a\nc\n", "a\nB\nc\n").conflict, true);
  assert.deepEqual(mergeText("a\nb\nc\nd\n", "a\nc\nd\n", "a\nb\nc\nD\n"), { text: "a\nc\nD\n", conflict: false });
});

test("no trailing newline preserved; empty base keeps both", () => {
  assert.deepEqual(mergeText("x", "x\ny", "x\nz"), { text: "x\ny\nz", conflict: false });
  assert.deepEqual(mergeText("", "hello\n", "world\n"), { text: "hello\nworld\n", conflict: false });
});

test("markers detection and block", () => {
  assert.equal(hasConflictMarkers("binh thuong\n=======\nkhong co khoi\n"), false);
  const b = conflictBlock("ours", "theirs");
  assert.ok(hasConflictMarkers(b) && b.includes("ours\n") && b.includes("theirs\n"));
});

test("insertion in the middle on both sides of different anchors", () => {
  const base = "1\n2\n3\n4\n5\n";
  const ours = "1\nA\n2\n3\n4\n5\n";
  const theirs = "1\n2\n3\n4\nB\n5\n";
  assert.deepEqual(mergeText(base, ours, theirs), { text: "1\nA\n2\n3\n4\nB\n5\n", conflict: false });
});

test("large documents with a single edit on each side merge fast", () => {
  const lines = Array.from({ length: 1500 }, (_, i) => `dong ${i}\n`);
  const ours = [...lines];
  ours[100] = "sua o may chu\n";
  const theirs = [...lines];
  theirs[1400] = "sua o thiet bi\n";
  const t0 = Date.now();
  const r = mergeText(lines.join(""), ours.join(""), theirs.join(""));
  assert.equal(r.conflict, false);
  assert.ok(r.text.includes("sua o may chu") && r.text.includes("sua o thiet bi"));
  assert.ok(Date.now() - t0 < 2000);
});

test("adjacent line edits merge without conflict", () => {
  assert.deepEqual(mergeText("l1\nl2\nl3\n", "l1\nX2\nl3\n", "L1\nl2\nl3\n"), { text: "L1\nX2\nl3\n", conflict: false });
  assert.deepEqual(mergeText("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nC\nd\n"), { text: "a\nB\nC\nd\n", conflict: false });
});

test("overlapping ranges still conflict", () => {
  const r = mergeText("a\nb\nc\n", "a\nB\nC\n", "a\nb\nCc\n");
  assert.equal(r.conflict, true);
  assert.ok(r.text.includes("C\n") && r.text.includes("Cc\n"));
});

test("insertion next to a replacement is independent; inside a replaced range conflicts", () => {
  assert.deepEqual(mergeText("a\nb\n", "a\nx\nb\n", "a\nB\n"), { text: "a\nx\nB\n", conflict: false });
  assert.deepEqual(mergeText("a\nb\n", "a\nB\n", "a\nx\nb\n"), { text: "a\nx\nB\n", conflict: false });
  assert.equal(mergeText("a\nb\nc\nd\n", "a\nX\nd\n", "a\nb\ninsertion\nc\nd\n").conflict, true);
});

test("many independent edits across a long note", () => {
  const base = Array.from({ length: 50 }, (_, i) => `dong ${i}\n`).join("");
  const ours = base.replace("dong 5\n", "O5\n").replace("dong 30\n", "O30\n");
  const theirs = base.replace("dong 6\n", "T6\n").replace("dong 45\n", "T45\n");
  const r = mergeText(base, ours, theirs);
  assert.equal(r.conflict, false);
  for (const x of ["O5\n", "T6\n", "O30\n", "T45\n"]) assert.ok(r.text.includes(x));
  assert.equal(r.text.split("\n").length - 1, 50);
});

test("resolveConflicts keeps server, mine, or both for every block", () => {
  const text = "a\n<<<<<<< MÁY CHỦ (bản hiện tại)\nB1\n=======\nB2\n>>>>>>> THIẾT BỊ CỦA BẠN\nc\n" +
    "<<<<<<< MÁY CHỦ (bản hiện tại)\nX\n=======\nY\n>>>>>>> THIẾT BỊ CỦA BẠN\n";
  assert.equal(resolveConflicts(text, "server"), "a\nB1\nc\nX\n");
  assert.equal(resolveConflicts(text, "mine"), "a\nB2\nc\nY\n");
  assert.equal(resolveConflicts(text, "both"), "a\nB1\nB2\nc\nX\nY\n");
  assert.equal(hasConflictMarkers(resolveConflicts(text, "both")), false);
  assert.equal(resolveConflicts("khong co khoi\n", "mine"), "khong co khoi\n");
});
