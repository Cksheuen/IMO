import assert from "node:assert/strict";
import { alignDiffLines } from "../src/lib/lineDiff.ts";
const compact = (rows) =>
  rows.map((row) => [
    row.before.line,
    row.after.line,
    row.before.kind,
    row.after.kind,
  ]);
assert.deepEqual(compact(alignDiffLines("a\nold\nb", "a\nnew\nb")), [
  [1, 1, "same", "same"],
  [2, null, "removed", "empty"],
  [null, 2, "empty", "added"],
  [3, 3, "same", "same"],
]);
assert.deepEqual(compact(alignDiffLines(undefined, "new")), [
  [null, 1, "empty", "added"],
]);
assert.deepEqual(compact(alignDiffLines("old", undefined)), [
  [1, null, "removed", "empty"],
]);
for (const [a, b] of [
  ["", ""],
  ["a\nb\na", "a\na"],
  ["a\n", "a\nnew\n"],
  ["unchanged", "unchanged"],
  ["x\n".repeat(1600), "y\n".repeat(1600)],
]) {
  const rows = alignDiffLines(a, b);
  assert.deepEqual(
    rows.flatMap((r) => (r.before.line === null ? [] : [r.before.line])),
    a.split("\n").map((_, i) => i + 1),
  );
  assert.deepEqual(
    rows.flatMap((r) => (r.after.line === null ? [] : [r.after.line])),
    b.split("\n").map((_, i) => i + 1),
  );
  for (const row of rows)
    if (row.before.kind === "same")
      assert.equal(
        a.split("\n")[row.before.line - 1],
        b.split("\n")[row.after.line - 1],
      );
}
console.log(
  "line diff: insert/delete gaps, stable original numbering, repeated/blank lines and bounded large input passed",
);
