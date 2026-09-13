export function diffLines(beforeText, afterText) {
  const a = String(beforeText || "").split("\n");
  const b = String(afterText || "").split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    const before = new Set(a);
    const after = new Set(b);
    return [
      ...a.filter((line) => !after.has(line)).map((line) => ({ type: "remove", line })),
      ...b.filter((line) => !before.has(line)).map((line) => ({ type: "add", line })),
    ];
  }
  const rows = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const output = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { output.push({ type: "same", line: a[i] }); i += 1; j += 1; }
    else if (j < m && (i >= n || rows[i][j + 1] >= rows[i + 1][j])) { output.push({ type: "add", line: b[j] }); j += 1; }
    else { output.push({ type: "remove", line: a[i] }); i += 1; }
  }
  return output;
}
