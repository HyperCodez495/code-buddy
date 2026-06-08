/**
 * ScreenWatcher — "know in real time what's happening on the machine".
 *
 * Periodically captures a frame, skips idle frames via a cheap fingerprint diff
 * (only surface frames that actually changed), optionally OCRs the frame and
 * REDACTS secrets/PII with the fleet privacy-lint before anything is stored or
 * sent to a model, and emits an Observation. This is the portable, local-first
 * foundation the research recommends (capture + dedup + OCR + redact) rather
 * than fragile per-frame video / Wayland-incompatible x11grab streaming.
 *
 * Downstream (not built here): feed observations to AutoRepairMiddleware on
 * detected errors, summarize the day into CODEBUDDY_MEMORY.md, or answer
 * "what did I see?" — see docs/screen-capture-and-ai.md.
 *
 * All side effects are injectable, so the loop is unit-tested without a display.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanForSecrets } from '../fleet/privacy-lint.js';

export interface Observation {
  ts: number;
  framePath: string;
  /** False when the frame is byte-identical to the previous one (idle). */
  changed: boolean;
  /** OCR text (only when `ocr` is enabled and the frame changed). */
  text?: string;
  /** Whether the OCR text had secrets/PII redacted. */
  redacted?: boolean;
}

export interface ScreenWatcherOptions {
  intervalMs?: number;
  /** Where frames are written (default: $TMPDIR/codebuddy-screen/watch). */
  outDir?: string;
  /** Run OCR on changed frames (needs `tesseract`). Default false. */
  ocr?: boolean;
  /** Capture a frame to `output`, resolve to the path. Injectable for tests. */
  capture?: (output: string) => Promise<string>;
  /**
   * Fingerprint a frame for dedup. Default: sha1 of file bytes. May be async —
   * e.g. the codebuddy-captured Rust daemon's perceptual hash, which dedups
   * near-identical frames (robust to lossy re-encode), unlike a byte sha1.
   */
  fingerprint?: (framePath: string) => string | Promise<string>;
  /** OCR a frame to text. Default: `tesseract <frame> stdout`. */
  ocrImpl?: (framePath: string) => Promise<string>;
  /** Redact secrets/PII from text. Default: privacy-lint. */
  redact?: (text: string) => { text: string; redacted: boolean };
  now?: () => number;
  /** Called for each emitted observation. */
  onObservation?: (obs: Observation) => void;
}

/** Replace every privacy-lint match span with `[REDACTED:<kind>]`. */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  const result = scanForSecrets(text);
  if (!result.hasSecrets) return { text, redacted: false };
  // Splice spans back-to-front so indices stay valid.
  const matches = [...result.matches].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of matches) {
    out = `${out.slice(0, m.start)}[REDACTED:${m.kind}]${out.slice(m.end)}`;
  }
  return { text: out, redacted: true };
}

function sha1File(framePath: string): string {
  try {
    return createHash('sha1').update(fs.readFileSync(framePath)).digest('hex');
  } catch {
    return `err-${Date.now()}`;
  }
}

export class ScreenWatcher {
  private readonly opts: Required<
    Pick<ScreenWatcherOptions, 'intervalMs' | 'outDir' | 'ocr' | 'fingerprint' | 'redact' | 'now'>
  > &
    ScreenWatcherOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint: string | null = null;
  private frameCount = 0;

  constructor(options: ScreenWatcherOptions = {}) {
    this.opts = {
      intervalMs: options.intervalMs ?? 5000,
      outDir: options.outDir ?? path.join(os.tmpdir(), 'codebuddy-screen', 'watch'),
      ocr: options.ocr ?? false,
      fingerprint: options.fingerprint ?? sha1File,
      redact: options.redact ?? redactSecrets,
      now: options.now ?? (() => Date.now()),
      ...options,
    };
  }

  /** One capture → dedup → (ocr+redact) cycle. Returns the observation. */
  async tick(): Promise<Observation> {
    fs.mkdirSync(this.opts.outDir, { recursive: true });
    const framePath = path.join(this.opts.outDir, `frame-${this.opts.now()}-${this.frameCount++}.png`);
    const capture = this.opts.capture ?? ((out: string) => this.defaultCapture(out));
    await capture(framePath);

    const fp = await this.opts.fingerprint(framePath);
    const changed = fp !== this.lastFingerprint;
    this.lastFingerprint = fp;

    const obs: Observation = { ts: this.opts.now(), framePath, changed };

    if (changed && this.opts.ocr) {
      const ocr = this.opts.ocrImpl ?? ((p: string) => this.defaultOcr(p));
      try {
        const raw = await ocr(framePath);
        const { text, redacted } = this.opts.redact(raw);
        obs.text = text;
        obs.redacted = redacted;
      } catch {
        /* OCR is best-effort */
      }
    }

    this.opts.onObservation?.(obs);
    return obs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs);
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async defaultCapture(output: string): Promise<string> {
    const { ScreenRecorder } = await import('./screen-recorder.js');
    return new ScreenRecorder().captureFrame(output);
  }

  private async defaultOcr(framePath: string): Promise<string> {
    const { execFile } = await import('child_process');
    return new Promise<string>((resolve) => {
      execFile('tesseract', [framePath, 'stdout'], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? '' : stdout.trim());
      });
    });
  }
}
