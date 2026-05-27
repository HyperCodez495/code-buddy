// Visual preview of the StatusBlock composition using the SAME pure helpers the
// Ink component renders from (no TTY needed). Shows: agent-activity head, an
// active compaction progress bar, and the live todo checklist.
// Run: npx tsx scratch/progress-preview.ts
import { formatTokenCount } from '../src/utils/token-counter.js';
import {
  ProgressTask,
  spinnerFrame,
  renderBar,
  formatElapsed,
  renderTodoLines,
  type TodoEntry,
} from '../src/utils/progress/index.js';

const todos: TodoEntry[] = [
  { label: 'P0b — Re-résolution multi-propriété (DIFFÉRÉ, non bloquant)', status: 'pending' },
  { label: 'P0c — Fallback universel (DIFFÉRÉ, non bloquant)', status: 'pending' },
  { label: 'P0a — Modèle de re-localisation (smart-snapshot.ts)', status: 'completed' },
  { label: 'P0d — Virtualisation (ItemContainer/Virtualized/ScrollItem)', status: 'completed' },
  { label: 'P0e — Tests + validation', status: 'completed' },
  { label: 'P0d-Avalonia', status: 'completed' },
  { label: 'Browser use — real-chromium E2E', status: 'completed' },
];

function frame(label: 'Agent activity' | 'Compaction (lib consumer)', lines: string[]) {
  console.log(`\n── ${label} ──`);
  for (const l of lines) console.log(l);
}

// A) Main agent-activity block (what the user pasted as "✽ Drizzling…").
{
  const star = spinnerFrame(3);
  const head = `${star} Generating response (7m 5s · ↑ ${formatTokenCount(19500)} tokens · esc to interrupt)`;
  frame('Agent activity', [head, ...renderTodoLines(todos, { maxVisible: 6 })]);
}

// B) Compaction as a progress-lib consumer (time-anchored bar at ~38%).
{
  const t0 = 1_000_000;
  const task = new ProgressTask(
    { kind: 'compaction', label: 'Compacting conversation…', mode: 'time-anchored', estimateMs: 40_000 },
    t0,
  );
  const snap = task.snapshot(t0 + 15_000);
  const head = `${spinnerFrame(1)} ${snap.label} (${formatElapsed(snap.elapsedMs)})`;
  const bar = `  ${renderBar(snap.percent ?? 0, 28)} ${Math.round(snap.percent ?? 0)}%`;
  frame('Compaction (lib consumer)', [head, bar, ...renderTodoLines(todos, { maxVisible: 6 })]);
}

console.log('');
