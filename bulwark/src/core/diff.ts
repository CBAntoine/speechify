// A small line diff for showing file changes in fix plans.

type Op = { kind: " " | "-" | "+"; line: string };

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Trim the common head and tail so the table stays small for typical config edits.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length;
  const cols = midB.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= rows; i++) table.push(new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  for (let k = 0; k < start; k++) ops.push({ kind: " ", line: a[k] });
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && midA[i] === midB[j]) {
      ops.push({ kind: " ", line: midA[i] });
      i++;
      j++;
    } else if (i < rows && (j >= cols || table[i + 1][j] >= table[i][j + 1])) {
      // Removals before additions, as in a normal unified diff.
      ops.push({ kind: "-", line: midA[i] });
      i++;
    } else {
      ops.push({ kind: "+", line: midB[j] });
      j++;
    }
  }
  for (let k = endA; k < n; k++) ops.push({ kind: " ", line: a[k] });
  return ops;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Unified diff with 3 lines of context. Returns "" when nothing changed. */
export function unifiedDiff(before: string | null, after: string, path: string): string {
  const a = splitLines(before ?? "");
  const b = splitLines(after);
  if (a.length * b.length > 4_000_000) return `(${path}: ${a.length} lines replaced by ${b.length} lines)`;
  const ops = lcsOps(a, b);
  if (!ops.some((o) => o.kind !== " ")) return "";
  const context = 3;
  const out: string[] = [`--- ${before === null ? "/dev/null" : path}`, `+++ ${path}`];
  let idx = 0;
  // Track line numbers for hunk headers.
  const posA: number[] = [];
  const posB: number[] = [];
  let la = 1;
  let lb = 1;
  for (const op of ops) {
    posA.push(la);
    posB.push(lb);
    if (op.kind !== "+") la++;
    if (op.kind !== "-") lb++;
  }
  while (idx < ops.length) {
    while (idx < ops.length && ops[idx].kind === " ") idx++;
    if (idx >= ops.length) break;
    let hunkStart = Math.max(0, idx - context);
    let hunkEnd = idx;
    // Extend the hunk while changes are close together.
    let lastChange = idx;
    while (hunkEnd < ops.length) {
      if (ops[hunkEnd].kind !== " ") lastChange = hunkEnd;
      if (hunkEnd - lastChange > context * 2) break;
      hunkEnd++;
    }
    hunkEnd = Math.min(ops.length, lastChange + context + 1);
    const slice = ops.slice(hunkStart, hunkEnd);
    const countA = slice.filter((o) => o.kind !== "+").length;
    const countB = slice.filter((o) => o.kind !== "-").length;
    const startA = countA === 0 ? posA[hunkStart] - 1 : posA[hunkStart];
    const startB = countB === 0 ? posB[hunkStart] - 1 : posB[hunkStart];
    out.push(`@@ -${startA},${countA} +${startB},${countB} @@`);
    for (const o of slice) out.push(`${o.kind}${o.line}`);
    idx = hunkEnd;
    hunkStart = hunkEnd;
  }
  return out.join("\n");
}
