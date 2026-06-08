/**
 * ScreenRecorder — capture a screen or window as a single frame or a video,
 * via ffmpeg. The "what's on the machine right now" primitive that the
 * ScreenWatcher (real-time AI awareness) and the `buddy screen` CLI build on.
 *
 * Capture backend by platform:
 *   - Linux X11 : ffmpeg `x11grab` (works on this repo's target; DISPLAY-based).
 *   - macOS     : ffmpeg `avfoundation`.
 *   - Windows   : ffmpeg `gdigrab`.
 *
 * Wayland note: `x11grab` does NOT work under a pure Wayland session — there you
 * need a portal/`wf-recorder` backend. We detect `XDG_SESSION_TYPE=wayland` and
 * surface a clear error rather than recording a black frame.
 *
 * The arg builders are pure (and unit-tested); the class is a thin spawn wrapper
 * with an injectable spawn for tests.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CaptureRegion {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface CaptureTarget {
  /** X11 display, e.g. ':0.0'. Default: process.env.DISPLAY || ':0.0'. */
  display?: string;
  /** Sub-region of the screen. Default: full screen at `screenSize`. */
  region?: CaptureRegion;
  /** Full screen size, used when no region is given (Linux needs an explicit size). */
  screenSize?: { width: number; height: number };
}

export interface RecordOptions extends CaptureTarget {
  fps?: number;
  /** Stop automatically after N seconds (omit for manual stop()). */
  durationSec?: number;
}

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

const DEFAULT_FPS = 15;
const DEFAULT_DISPLAY = ':0.0';

function regionSize(target: CaptureTarget): { width: number; height: number } {
  if (target.region) return { width: target.region.width, height: target.region.height };
  if (target.screenSize) return target.screenSize;
  return { width: 1920, height: 1080 };
}

/** Detect a Wayland session, where x11grab silently fails. */
export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['XDG_SESSION_TYPE'] || '').toLowerCase() === 'wayland' || Boolean(env['WAYLAND_DISPLAY'] && !env['DISPLAY']);
}

/** ffmpeg args for a single still frame → `output` (png/jpg by extension). */
export function buildFrameArgs(
  output: string,
  target: CaptureTarget = {},
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  const { width, height } = regionSize(target);
  if (platform === 'linux') {
    const display = target.display || process.env['DISPLAY'] || DEFAULT_DISPLAY;
    const off = target.region ? `+${target.region.x ?? 0},${target.region.y ?? 0}` : '';
    return {
      cmd: 'ffmpeg',
      args: ['-y', '-f', 'x11grab', '-video_size', `${width}x${height}`, '-i', `${display}${off}`, '-frames:v', '1', output],
    };
  }
  if (platform === 'darwin') {
    return { cmd: 'ffmpeg', args: ['-y', '-f', 'avfoundation', '-framerate', '1', '-i', '1:none', '-frames:v', '1', output] };
  }
  // win32
  return { cmd: 'ffmpeg', args: ['-y', '-f', 'gdigrab', '-framerate', '1', '-i', 'desktop', '-frames:v', '1', output] };
}

/** ffmpeg args for a screen video recording → `output` (mp4 by extension). */
export function buildRecordArgs(
  output: string,
  opts: RecordOptions = {},
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  const fps = opts.fps ?? DEFAULT_FPS;
  const { width, height } = regionSize(opts);
  const dur = opts.durationSec && opts.durationSec > 0 ? ['-t', String(opts.durationSec)] : [];
  if (platform === 'linux') {
    const display = opts.display || process.env['DISPLAY'] || DEFAULT_DISPLAY;
    const off = opts.region ? `+${opts.region.x ?? 0},${opts.region.y ?? 0}` : '';
    return {
      cmd: 'ffmpeg',
      args: [
        '-y', '-f', 'x11grab', '-framerate', String(fps), '-video_size', `${width}x${height}`,
        '-i', `${display}${off}`, ...dur, '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', output,
      ],
    };
  }
  if (platform === 'darwin') {
    return { cmd: 'ffmpeg', args: ['-y', '-f', 'avfoundation', '-framerate', String(fps), '-i', '1:none', ...dur, '-pix_fmt', 'yuv420p', output] };
  }
  return { cmd: 'ffmpeg', args: ['-y', '-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop', ...dur, '-pix_fmt', 'yuv420p', output] };
}

export class ScreenRecorder {
  private proc: ChildProcess | null = null;
  private readonly doSpawn: SpawnLike;

  constructor(opts: { spawnImpl?: SpawnLike } = {}) {
    this.doSpawn = opts.spawnImpl ?? (spawn as unknown as SpawnLike);
  }

  /** Capture one frame; resolves to the output path. */
  captureFrame(output: string, target: CaptureTarget = {}): Promise<string> {
    if (process.platform === 'linux' && isWaylandSession()) {
      return Promise.reject(new Error('Wayland session: x11grab cannot capture. Use a portal/wf-recorder backend.'));
    }
    const { cmd, args } = buildFrameArgs(output, target);
    return new Promise((resolve, reject) => {
      const p = this.doSpawn(cmd, args, { stdio: 'ignore' });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg exited ${code}`))));
    });
  }

  /** Start a video recording. Returns the output path; call stop() to finish. */
  start(output: string, opts: RecordOptions = {}): string {
    if (this.proc) throw new Error('already recording');
    if (process.platform === 'linux' && isWaylandSession()) {
      throw new Error('Wayland session: x11grab cannot record. Use a portal/wf-recorder backend.');
    }
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    const { cmd, args } = buildRecordArgs(output, opts);
    this.proc = this.doSpawn(cmd, args, { stdio: 'ignore' });
    return output;
  }

  isRecording(): boolean {
    return this.proc !== null;
  }

  /** Stop recording gracefully (ffmpeg flushes the moov atom on SIGINT/`q`). */
  async stop(): Promise<void> {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    await new Promise<void>((resolve) => {
      p.on('exit', () => resolve());
      try {
        // `q` on stdin is the clean ffmpeg stop; fall back to SIGINT.
        p.stdin?.write('q');
        p.stdin?.end();
      } catch {
        /* ignore */
      }
      p.kill('SIGINT');
      setTimeout(resolve, 4000); // safety: never hang
    });
  }
}

/** Best-effort default scratch path for captures. */
export function defaultCaptureDir(): string {
  return path.join(os.tmpdir(), 'codebuddy-screen');
}
