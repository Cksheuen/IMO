export type DiffDisplayLine = {
  line: number | null;
  kind: "same" | "added" | "removed" | "empty";
};
export type DiffRow = { before: DiffDisplayLine; after: DiffDisplayLine };
/** Stable source line numbers and explicit opposite-side gaps. Bound the LCS matrix for large inputs. */
export function alignDiffLines(before?: string, after?: string): DiffRow[] {
  const a = before === undefined ? [] : before.split("\n");
  const b = after === undefined ? [] : after.split("\n");
  const rows: DiffRow[] = [];
  const same = (i: number, j: number) =>
    rows.push({
      before: { line: i + 1, kind: "same" },
      after: { line: j + 1, kind: "same" },
    });
  const remove = (i: number) =>
    rows.push({
      before: { line: i + 1, kind: "removed" },
      after: { line: null, kind: "empty" },
    });
  const add = (j: number) =>
    rows.push({
      before: { line: null, kind: "empty" },
      after: { line: j + 1, kind: "added" },
    });
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    same(start, start);
    start++;
  }
  let ae = a.length,
    be = b.length;
  while (ae > start && be > start && a[ae - 1] === b[be - 1]) {
    ae--;
    be--;
  }
  const n = ae - start,
    m = be - start;
  if ((n + 1) * (m + 1) <= 2_000_000) {
    const width = m + 1,
      table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? 1 + table[(i + 1) * width + j + 1]
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        same(start + i++, start + j++);
      } else if (
        i < n &&
        (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])
      )
        remove(start + i++);
      else add(start + j++);
    }
  } else {
    for (let i = start; i < ae; i++) remove(i);
    for (let j = start; j < be; j++) add(j);
  }
  while (ae < a.length && be < b.length) same(ae++, be++);
  return rows;
}
