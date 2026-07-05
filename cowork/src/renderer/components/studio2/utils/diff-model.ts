export type DiffKind = 'unchanged' | 'added' | 'removed';
export interface DiffLine { kind: DiffKind; beforeLine?: number; afterLine?: number; text: string; }
function lines(text: string): string[] { return text.length ? text.split('\n') : []; }
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before); const b = lines(after); const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = []; let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: 'unchanged', beforeLine: i + 1, afterLine: j + 1, text: a[i] }); i += 1; j += 1; }
    else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) { out.push({ kind: 'added', afterLine: j + 1, text: b[j] }); j += 1; }
    else { out.push({ kind: 'removed', beforeLine: i + 1, text: a[i] }); i += 1; }
  }
  return out;
}
