/**
 * Research / Flow live launcher — shared payload types between the
 * main-process bridge, the preload surface, and the renderer panel.
 *
 * The launcher runs the REAL core CLI (`buddy research` / `buddy flow`)
 * as a child process — the GUI launches and observes, the CLI owns the
 * workflow (same doctrine as `spec.next` and `autonomy.runTick`).
 */

export type LiveLauncherKind = 'research' | 'flow';

export type LiveLauncherRunStatusValue = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface LiveLauncherStartInput {
  kind: LiveLauncherKind;
  /** Research topic or flow goal. */
  prompt: string;
  /** Model override (default: the autonomy ladder's local $0 choice). */
  model?: string;
  /** 'ollama' (default — $0 local) pins CODEBUDDY_PROVIDER; 'inherit' uses ambient env. */
  provider?: 'ollama' | 'inherit';
  /** Required acknowledgement before the main process accepts ambient/cloud credentials. */
  confirmInheritedProvider?: boolean;
  /** Ollama base URL when provider==='ollama' (default http://localhost:11434). */
  ollamaUrl?: string;
  /** Research only — force the parallel-worker (Manus-style) mode in headless runs. */
  wide?: boolean;
  /** Research only — worker count for wide mode. */
  workers?: number;
  /**
   * Research only — Deep Research: the deterministic, cited pipeline
   * (`buddy research --deep`). Additive to `wide`; when both are set `deep`
   * takes precedence (the CLI's `--deep` short-circuits the wide path).
   */
  deep?: boolean;
  /** Research only — Deep Research gap-analysis rounds (`--iterations`, 1-3). */
  iterations?: number;
  /** Research only — Deep Research STORM perspectives (`--perspectives`, 2-6). */
  perspectives?: number;
  /** Flow only — max retries per failed step. */
  maxRetries?: number;
  /** Overall timeout. Defaults depend on mode (direct 5m, wide 15m, deep 30m, flow 10m). */
  timeoutMs?: number;
}

export interface LiveLauncherRunView {
  runId: string;
  kind: LiveLauncherKind;
  /** Normalized launch mode retained so Cowork can faithfully prepare a rerun. */
  researchMode?: 'direct' | 'wide' | 'deep';
  prompt: string;
  model?: string;
  provider: 'ollama' | 'inherit';
  /** Effective Ollama endpoint retained for transparent, faithful reruns. */
  ollamaUrl?: string;
  workers?: number;
  iterations?: number;
  perspectives?: number;
  maxRetries?: number;
  timeoutMs?: number;
  status: LiveLauncherRunStatusValue;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  /** Research artifact path (markdown report). */
  reportPath?: string;
  /** Capped tail of stdout+stderr lines. */
  logTail: string[];
  /** Summary metadata returned by list() without transferring the full log. */
  logLineCount?: number;
  hasResult?: boolean;
  /** Final output: research report content, or the flow's stdout. */
  result?: string;
  error?: string;
}

export type LiveLauncherEventPayload =
  | { runId: string; kind: 'log'; stream: 'stdout' | 'stderr'; lines: string[] }
  | { runId: string; kind: 'status'; run: LiveLauncherRunView };
