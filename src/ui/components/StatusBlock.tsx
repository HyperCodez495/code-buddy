import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { formatTokenCount } from '../../utils/token-counter.js';
import { useTheme } from '../context/theme-context.js';
import { getTodoTracker, type TodoStatus as TrackerStatus } from '../../agent/todo-tracker.js';
import {
  getProgressManager,
  spinnerFrame,
  renderBar,
  renderIndeterminateBar,
  formatElapsed,
  renderTodoLines,
  type TodoEntry,
  type TodoStatus as RenderStatus,
} from '../../utils/progress/index.js';

/**
 * Unified activity / progress / todo status block.
 *
 * Single owner of the "something is happening" region beneath the chat, replacing
 * the old standalone spinner. Renders, top-to-bottom:
 *   1. an animated head line — `✽ <activity> (<elapsed> · ↑<tokens> tokens · esc to interrupt)`
 *   2. an optional progress bar — when a {@link ProgressManager} task is active
 *      (e.g. compaction), `▰▰▰▱▱ 37%` plus a `⎿ Next:` hint
 *   3. the live todo checklist from {@link TodoTracker} — `◻`/`✔` with `… +N completed` overflow
 *
 * The block animates on a single 120 ms tick while active and polls the todo list
 * each tick (the tracker has no change events). It is mutually exclusive with any
 * other activity indicator: when nothing is happening it renders nothing.
 */
const BAR_WIDTH = 28;
const MAX_TODOS = 6;

const STATUS_MAP: Record<TrackerStatus, RenderStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  done: 'completed',
  blocked: 'error',
};

interface StatusBlockProps {
  isActive: boolean;
  processingTime: number;
  tokenCount: number;
  /** Current agent activity description (e.g. "Executing: read_file"). */
  activity?: string;
  /** Working directory whose todo list to surface (defaults to process.cwd()). */
  workDir?: string;
}

export const StatusBlock = React.memo(function StatusBlockInner({
  isActive,
  processingTime,
  tokenCount,
  activity,
  workDir,
}: StatusBlockProps) {
  const { colors } = useTheme();
  const [frame, setFrame] = useState(0);
  // Bump to force a re-read when a progress task starts/ends between ticks.
  const [, forceRender] = useState(0);

  useEffect(() => {
    const mgr = getProgressManager();
    const onChange = () => forceRender((n) => n + 1);
    mgr.on('start', onChange);
    mgr.on('end', onChange);
    return () => {
      mgr.off('start', onChange);
      mgr.off('end', onChange);
    };
  }, []);

  const snapshot = getProgressManager().getMostRecent();
  const active = isActive || snapshot !== null;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setFrame((f) => f + 1), 120);
    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  // --- Head line ---------------------------------------------------------
  const star = spinnerFrame(frame);
  const label = isActive ? activity || 'Working' : snapshot?.label ?? 'Working';
  const elapsed = isActive ? `${processingTime}s` : formatElapsed(snapshot?.elapsedMs ?? 0);
  const tokenSeg = isActive && tokenCount > 0 ? ` · ↑ ${formatTokenCount(tokenCount)} tokens` : '';
  const interruptSeg = isActive ? ' · esc to interrupt' : '';

  // --- Progress bar (optional) ------------------------------------------
  const showBar = snapshot !== null && snapshot.status === 'running';
  const barText = showBar
    ? snapshot!.percent === null
      ? renderIndeterminateBar(frame, BAR_WIDTH)
      : `${renderBar(snapshot!.percent, BAR_WIDTH)} ${Math.round(snapshot!.percent)}%`
    : '';
  const nextHint = showBar && snapshot!.nextHint?.trim() ? snapshot!.nextHint.trim() : '';

  // --- Todo checklist ----------------------------------------------------
  const todoItems = getTodoTracker(workDir).getAll();
  const todoEntries: TodoEntry[] = todoItems.map((t) => ({ label: t.text, status: STATUS_MAP[t.status] }));
  const todoLines = renderTodoLines(todoEntries, { maxVisible: MAX_TODOS });

  const todoColor = (line: string) => {
    if (line.includes('✔')) return colors.success;
    if (line.includes('✗')) return colors.error;
    if (line.includes('… +')) return colors.textMuted;
    return colors.primary; // ◻ pending / in-progress
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={colors.spinner} bold>
          {star}{' '}
        </Text>
        <Text color={colors.primary}>{label} </Text>
        <Text color={colors.textMuted}>
          ({elapsed}
          {tokenSeg}
          {interruptSeg})
        </Text>
      </Box>

      {showBar && (
        <Box>
          <Text color={colors.secondary}>  {barText}</Text>
        </Box>
      )}
      {nextHint !== '' && (
        <Box>
          <Text color={colors.textMuted}>  ⎿  Next: {nextHint}</Text>
        </Box>
      )}

      {todoLines.map((line, i) => (
        <Box key={i}>
          <Text color={todoColor(line)}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
});
