/**
 * ScreenErrorWatcher — Tier-1 use case from docs/screen-capture-and-ai.md.
 *
 * Watches the screen (via {@link ScreenWatcher}), and when OCR text on a changed
 * frame contains an error / stack trace, feeds it to the existing
 * {@link FaultLocalizer} (the engine behind AutoRepairMiddleware) to localize the
 * fault to file:line — proactively, from whatever is on the terminal/IDE, with
 * no human paste. The screen becomes a new trigger source for repair machinery
 * Code Buddy already runs.
 *
 * Fully local: OCR (tesseract) + spectrum/stack-trace fault localization, no LLM
 * call. OCR text is already secret/PII-redacted by ScreenWatcher before it gets
 * here.
 */
import { ScreenWatcher, type Observation, type ScreenWatcherOptions } from './screen-watcher.js';
import type { FaultLocalizationResult } from '../agent/repair/types.js';

export interface DetectedError {
  /** The OCR text the error was found in (already redacted). */
  text: string;
  /** Which pattern matched (for the report). */
  pattern: string;
}

export interface RepairSuggestion {
  ts: number;
  error: DetectedError;
  localization: FaultLocalizationResult;
}

/**
 * Error / stack-trace signatures across common stacks. First match wins; we keep
 * the whole frame text (the localizer parses stack frames out of it).
 */
// Order matters — specific signatures before the generic "at file:line:col"
// stack-frame matcher, which would otherwise shadow rust/go/python traces.
const ERROR_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ts-error', re: /error TS\d{3,}:/ },
  { name: 'js-error', re: /\b(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError|AssertionError)\b\s*:/ },
  { name: 'python-traceback', re: /Traceback \(most recent call last\)/ },
  { name: 'python-exception', re: /\b\w*(Error|Exception)\b:\s+\S/ },
  { name: 'java-exception', re: /\bjava\.[\w.]+(Exception|Error)\b/ },
  { name: 'rust-panic', re: /thread '.*' panicked at/ },
  { name: 'go-panic', re: /\bpanic:\s+\S/ },
  { name: 'segfault', re: /Segmentation fault|SIGSEGV|core dumped/ },
  { name: 'cpp-error', re: /\berror:\s+.+\b(undefined reference|no matching|expected)\b/i },
  { name: 'node-stack', re: /\n?\s*at\s+.+\(?[^\s]+:\d+:\d+\)?/ },
  { name: 'test-failure', re: /\b(FAILED|FAIL|✗|×|AssertionError)\b/ },
  { name: 'build-failure', re: /\b(build failed|compilation failed|Compilation error|Module not found)\b/i },
];

/** Detect an error/stack-trace in OCR text. Returns null when none. */
export function detectError(text: string): DetectedError | null {
  if (!text || text.length < 6) return null;
  for (const p of ERROR_PATTERNS) {
    if (p.re.test(text)) return { text, pattern: p.name };
  }
  return null;
}

/** A short, stable key for an error so we don't re-localize the same one. */
function errorKey(text: string): string {
  // The first line that looks like an error message.
  const line =
    text.split('\n').find((l) => /error|exception|panic|fail|traceback/i.test(l))?.trim() ?? text.slice(0, 80);
  return line.replace(/\s+/g, ' ').slice(0, 120);
}

export interface ScreenErrorWatcherOptions {
  /** Passed through to the underlying ScreenWatcher (interval, outDir, …). `ocr` is forced on. */
  watcher?: Omit<ScreenWatcherOptions, 'ocr' | 'onObservation'>;
  /** Localize an error text → faults. Default: a local FaultLocalizer over the cwd. */
  localize?: (errorText: string) => Promise<FaultLocalizationResult>;
  /** Don't re-localize the same error within this window. Default 60s. */
  cooldownMs?: number;
  now?: () => number;
  /** Called when an error is localized. */
  onSuggestion?: (s: RepairSuggestion) => void;
  /** Called for every observation (changed or idle), for logging. */
  onObservation?: (obs: Observation) => void;
}

export class ScreenErrorWatcher {
  private readonly localize: (text: string) => Promise<FaultLocalizationResult>;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onSuggestion?: (s: RepairSuggestion) => void;
  private readonly onObservation?: (obs: Observation) => void;
  private readonly watcher: ScreenWatcher;
  private readonly recent = new Map<string, number>(); // errorKey → ts

  constructor(opts: ScreenErrorWatcherOptions = {}) {
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
    this.localize = opts.localize ?? ((text) => this.defaultLocalize(text));
    if (opts.onSuggestion) this.onSuggestion = opts.onSuggestion;
    if (opts.onObservation) this.onObservation = opts.onObservation;
    this.watcher = new ScreenWatcher({
      ...(opts.watcher ?? {}),
      ocr: true,
      onObservation: (obs) => void this.handle(obs),
    });
  }

  /** Process one observation: detect an error, localize it (with cooldown). */
  async processObservation(obs: Observation): Promise<RepairSuggestion | null> {
    if (!obs.changed || !obs.text) return null;
    const detected = detectError(obs.text);
    if (!detected) return null;

    const key = errorKey(detected.text);
    const last = this.recent.get(key);
    const t = this.now();
    if (last !== undefined && t - last < this.cooldownMs) return null;
    this.recent.set(key, t);

    let localization: FaultLocalizationResult;
    try {
      localization = await this.localize(detected.text);
    } catch {
      return null;
    }
    const suggestion: RepairSuggestion = { ts: t, error: detected, localization };
    this.onSuggestion?.(suggestion);
    return suggestion;
  }

  private async handle(obs: Observation): Promise<void> {
    this.onObservation?.(obs);
    await this.processObservation(obs);
  }

  /** Drive one capture→detect→localize cycle (for one-shot / tests). */
  async tick(): Promise<void> {
    await this.watcher.tick();
  }

  start(): void {
    this.watcher.start();
  }

  stop(): void {
    this.watcher.stop();
  }

  private async defaultLocalize(errorText: string): Promise<FaultLocalizationResult> {
    const { FaultLocalizer } = await import('../agent/repair/fault-localization.js');
    const fs = await import('fs');
    const fileReader = async (p: string): Promise<string> => {
      try {
        return await fs.promises.readFile(p, 'utf-8');
      } catch {
        return '';
      }
    };
    return new FaultLocalizer({}, fileReader).localize(errorText);
  }
}
