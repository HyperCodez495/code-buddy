/**
 * Pure formatting helpers for the embedded Activity pane (new shell, cowork/REDESIGN.md slice 2).
 *
 * Turns the raw per-session `TraceStep[]` into a calm, plain-language work-log line per step — the
 * "live reasoning log, not a spinner" UX principle. Kept pure + deterministic so it's unit-tested
 * without a React tree; the component is a thin renderer over these.
 */
import type { TraceStep, DiffPreview, DiffEntry } from '../types';

export interface ActivityLine {
  id: string;
  glyph: string;
  /** Short human label ("Outil : view_file", "Réflexion", "Réponse"). */
  label: string;
  /** Optional one-line detail (tool target, error, preview). */
  detail?: string;
  status: TraceStep['status'];
  running: boolean;
  error: boolean;
  timestamp: number;
  durationMs?: number;
}

function firstLine(s: string | undefined, max = 120): string | undefined {
  if (!s) return undefined;
  const line = s.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A compact, human tool target from the tool input (path/query/command when present). */
function toolTarget(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const key = ['path', 'file', 'file_path', 'query', 'command', 'pattern', 'url'].find(
    (k) => typeof input[k] === 'string' && (input[k] as string).trim(),
  );
  return key ? firstLine(String(input[key]), 80) : undefined;
}

/** Map one trace step to a calm activity line. */
export function traceStepToLine(step: TraceStep): ActivityLine {
  const running = step.status === 'running' || step.status === 'pending';
  const error = step.status === 'error' || step.isError === true;
  let glyph = '•';
  let label = step.title || step.type;
  let detail = firstLine(step.content);

  switch (step.type) {
    case 'thinking':
      glyph = '💭';
      label = 'Réflexion';
      break;
    case 'text':
      glyph = '💬';
      label = 'Réponse';
      break;
    case 'tool_call':
      glyph = '🔧';
      label = `Outil : ${step.toolName ?? step.title ?? 'action'}`;
      detail = toolTarget(step.toolInput) ?? detail;
      break;
    case 'tool_result':
      glyph = error ? '✗' : '✓';
      label = step.toolName ? `Résultat : ${step.toolName}` : 'Résultat';
      detail = firstLine(step.toolOutput) ?? detail;
      break;
  }
  if (error) glyph = '✗';

  return {
    id: step.id,
    glyph,
    label,
    detail,
    status: step.status,
    running,
    error,
    timestamp: step.timestamp,
    durationMs: step.duration,
  };
}

/**
 * Flatten a session's diff previews into the set of changed files, deduped by path (the latest
 * change for each path wins), preserving first-seen order. Powers the Activity pane's reviewable
 * "Fichiers modifiés" section.
 */
export function collectSessionDiffs(previews: readonly DiffPreview[] | undefined): DiffEntry[] {
  if (!previews || previews.length === 0) return [];
  const byPath = new Map<string, DiffEntry>();
  for (const preview of previews) {
    for (const entry of preview.diffs ?? []) {
      if (entry?.path) byPath.set(entry.path, entry); // later preview overwrites → latest state
    }
  }
  return [...byPath.values()];
}

/** One-line status summary for the pane header. */
export function activityStatus(
  steps: readonly TraceStep[],
  activeTurn: { stepId: string } | null,
): { text: string; busy: boolean } {
  const busy = activeTurn != null || steps.some((s) => s.status === 'running' || s.status === 'pending');
  if (busy) return { text: 'En cours…', busy: true };
  if (steps.some((s) => s.status === 'error' || s.isError)) return { text: 'Terminé (avec une erreur)', busy: false };
  if (steps.length === 0) return { text: 'Rien pour l’instant', busy: false };
  return { text: 'Terminé', busy: false };
}
