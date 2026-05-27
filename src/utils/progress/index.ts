/**
 * Progress library — a framework-agnostic model for reporting and rendering the
 * progress of any long-running operation (determinate, indeterminate, or
 * time-anchored), plus a pure checklist renderer for live todo lists.
 *
 * Producers:  `getProgressManager().start({ kind, label, mode })` → drive the
 *             returned handle with `update` / `complete` / `fail`.
 * Renderers:  subscribe to the manager's `start` / `update` / `end` events and
 *             draw with the pure helpers in `render.ts`.
 */
export type {
  ProgressMode,
  ProgressStatus,
  ProgressInit,
  ProgressSnapshot,
  ProgressEvents,
} from './types.js';
export { ProgressTask, TIME_ANCHORED_CAP } from './progress-task.js';
export { DurationEstimator, median } from './duration-estimator.js';
export {
  ProgressManager,
  getProgressManager,
  __setProgressManagerForTests,
  type ProgressManagerOptions,
} from './progress-manager.js';
export {
  STAR_FRAMES,
  BAR_FILLED,
  BAR_EMPTY,
  TODO_GLYPH,
  spinnerFrame,
  formatElapsed,
  renderBar,
  renderIndeterminateBar,
  renderProgressLines,
  renderTodoLines,
  type TodoStatus,
  type TodoEntry,
} from './render.js';
