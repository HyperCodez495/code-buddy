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
   * Fingerprint a frame for dedup. Default: Sharp dHash + colour signature,
   * falling back to an exact SHA-256 when the optional image stack is absent.
   */
  fingerprint?: (framePath: string) => string | Promise<string>;
  /** Maximum differing bits for perceptual hashes to still count as idle. Default: 6. */
  perceptualHashThreshold?: number;
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

function sha256File(framePath: string): string {
  try {
    return `sha256:${createHash('sha256').update(fs.readFileSync(framePath)).digest('hex')}`;
  } catch {
    return `err-${Date.now()}`;
  }
}

const HEX_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;

/** Hamming + coarse colour distance for dHash fingerprints, or null for other formats. */
export function perceptualHashDistance(left: string, right: string): number | null {
  const matchLeft = /^dhash:([0-9a-f]{16})(?::([0-9a-f]{6}))?$/i.exec(left);
  const matchRight = /^dhash:([0-9a-f]{16})(?::([0-9a-f]{6}))?$/i.exec(right);
  if (!matchLeft || !matchRight) return null;
  let distance = 0;
  for (let index = 0; index < 16; index++) {
    const xor = Number.parseInt(matchLeft[1]![index]!, 16)
      ^ Number.parseInt(matchRight[1]![index]!, 16);
    distance += HEX_BITS[xor]!;
  }
  if (matchLeft[2] && matchRight[2]) {
    const channelDelta = [0, 2, 4].reduce((largest, offset) => Math.max(
      largest,
      Math.abs(
        Number.parseInt(matchLeft[2]!.slice(offset, offset + 2), 16)
        - Number.parseInt(matchRight[2]!.slice(offset, offset + 2), 16),
      ),
    ), 0);
    distance += Math.ceil(channelDelta / 16);
  }
  return distance;
}

/**
 * Compute a compact visual dHash through optional Sharp. Byte hashing remains a
 * fail-closed fallback when Sharp or the image decoder is unavailable.
 */
async function perceptualFingerprint(framePath: string): Promise<string> {
  try {
    const { default: sharp } = await import('sharp');
    const { data: pixels, info } = await sharp(framePath)
      .resize(9, 8, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const luminance: number[] = [];
    const colourTotals = [0, 0, 0];
    for (let pixel = 0; pixel < 72; pixel++) {
      const offset = pixel * info.channels;
      const red = pixels[offset]!;
      const green = pixels[offset + Math.min(1, info.channels - 1)]!;
      const blue = pixels[offset + Math.min(2, info.channels - 1)]!;
      luminance.push(Math.round(0.299 * red + 0.587 * green + 0.114 * blue));
      colourTotals[0]! += red;
      colourTotals[1]! += green;
      colourTotals[2]! += blue;
    }
    let bits = '';
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const offset = row * 9 + column;
        bits += luminance[offset]! > luminance[offset + 1]! ? '1' : '0';
      }
    }
    const colour = colourTotals
      .map((total) => Math.round(total / 72).toString(16).padStart(2, '0'))
      .join('');
    return `dhash:${BigInt(`0b${bits}`).toString(16).padStart(16, '0')}:${colour}`;
  } catch {
    return sha256File(framePath);
  }
}

export class ScreenWatcher {
  private readonly opts: Required<
    Pick<
      ScreenWatcherOptions,
      | 'intervalMs'
      | 'outDir'
      | 'ocr'
      | 'fingerprint'
      | 'perceptualHashThreshold'
      | 'redact'
      | 'now'
    >
  > &
    ScreenWatcherOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint: string | null = null;
  private frameCount = 0;

  constructor(options: ScreenWatcherOptions = {}) {
    this.opts = {
      ...options,
      intervalMs: options.intervalMs ?? 5000,
      outDir: options.outDir ?? path.join(os.tmpdir(), 'codebuddy-screen', 'watch'),
      ocr: options.ocr ?? false,
      fingerprint: options.fingerprint ?? perceptualFingerprint,
      perceptualHashThreshold: Math.max(0, Math.min(64, options.perceptualHashThreshold ?? 6)),
      redact: options.redact ?? redactSecrets,
      now: options.now ?? (() => Date.now()),
    };
  }

  /** One capture → dedup → (ocr+redact) cycle. Returns the observation. */
  async tick(): Promise<Observation> {
    fs.mkdirSync(this.opts.outDir, { recursive: true });
    const requestedPath = path.join(
      this.opts.outDir,
      `frame-${this.opts.now()}-${this.frameCount++}.webp`,
    );
    const capture = this.opts.capture ?? ((out: string) => this.defaultCapture(out));
    const framePath = await capture(requestedPath);

    const fp = await this.opts.fingerprint(framePath);
    const distance = this.lastFingerprint === null
      ? null
      : perceptualHashDistance(this.lastFingerprint, fp);
    const changed = this.lastFingerprint === null
      || (distance === null ? fp !== this.lastFingerprint : distance > this.opts.perceptualHashThreshold);
    // Compare future frames with the last meaningful scene, not the immediately
    // previous idle frame; otherwise tiny changes could drift forever unseen.
    if (changed) this.lastFingerprint = fp;

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
    const recorder = new ScreenRecorder();
    try {
      return await recorder.captureFrame(output);
    } catch (error) {
      if (path.extname(output).toLowerCase() !== '.webp') throw error;
      const fallback = `${output.slice(0, -5)}.png`;
      return recorder.captureFrame(fallback);
    }
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
