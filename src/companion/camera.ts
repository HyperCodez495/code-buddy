import { spawn as nodeSpawn, execFile as nodeExecFile } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import * as path from 'path';
import { recordCompanionPercept } from './percepts.js';

export interface CameraRuntime {
  execFile: (
    command: string,
    args: string[],
    options: { timeout: number },
    callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
  ) => void;
  spawn: (
    command: string,
    args: string[],
    options: { stdio: ['ignore', 'pipe', 'pipe'] },
  ) => CameraChildProcess;
}

export interface CameraChildProcess {
  stdout?: {
    on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  };
  stderr?: {
    on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  };
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CameraCheckOptions {
  runtime?: CameraRuntime;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export interface CameraStatus {
  available: boolean;
  ffmpegAvailable: boolean;
  platform: NodeJS.Platform;
  commandPreview?: string;
  reason?: string;
}

export interface CameraSnapshotOptions {
  cwd?: string;
  outputPath?: string;
  device?: string;
  timeoutMs?: number;
  runtime?: CameraRuntime;
  platform?: NodeJS.Platform;
  recordPercept?: boolean;
}

export interface CameraSnapshotResult {
  success: boolean;
  path?: string;
  output?: string;
  error?: string;
  command?: string;
  perceptId?: string;
  perceptPath?: string;
}

const DEFAULT_CAMERA_TIMEOUT_MS = 10000;

const defaultRuntime: CameraRuntime = {
  execFile: (command, args, options, callback) => {
    nodeExecFile(command, args, options, callback);
  },
  spawn: (command, args, options) => nodeSpawn(command, args, options) as CameraChildProcess,
};

function toText(value: string | Buffer | undefined): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value ?? '';
}

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function buildCommandPreview(args: string[]): string {
  return ['ffmpeg', ...args].map(quoteArg).join(' ');
}

function defaultDeviceForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'video=Integrated Camera';
  if (platform === 'darwin') return '0';
  return '/dev/video0';
}

function cameraTroubleshooting(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'Check camera permissions and list devices with `ffmpeg -list_devices true -f dshow -i dummy`, then retry with --device "video=<camera name>".';
  }
  if (platform === 'darwin') {
    return 'Check macOS camera permissions and list devices with `ffmpeg -f avfoundation -list_devices true -i ""`, then retry with --device <index>.';
  }
  return 'Check camera permissions and available devices such as /dev/video0, then retry with --device /dev/videoN.';
}

export function buildCameraSnapshotArgs(
  platform: NodeJS.Platform,
  device: string | undefined,
  outputPath: string,
): string[] {
  const selectedDevice = device || defaultDeviceForPlatform(platform);

  if (platform === 'win32') {
    return [
      '-y',
      '-f',
      'dshow',
      '-i',
      selectedDevice,
      '-frames:v',
      '1',
      outputPath,
    ];
  }

  if (platform === 'darwin') {
    return [
      '-y',
      '-f',
      'avfoundation',
      '-i',
      selectedDevice,
      '-frames:v',
      '1',
      outputPath,
    ];
  }

  return [
    '-y',
    '-f',
    'video4linux2',
    '-i',
    selectedDevice,
    '-frames:v',
    '1',
    outputPath,
  ];
}

export function getDefaultCameraOutputPath(cwd = process.cwd(), date = new Date()): string {
  const stamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return path.join(cwd, '.codebuddy', 'camera', `camera-${stamp}.png`);
}

async function execFileResult(
  runtime: CameraRuntime,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise(resolve => {
    runtime.execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: toText(stdout),
        stderr: toText(stderr),
        error: error?.message,
      });
    });
  });
}

export async function checkCameraAvailability(
  options: CameraCheckOptions = {},
): Promise<CameraStatus> {
  const runtime = options.runtime || defaultRuntime;
  const platform = options.platform || process.platform;
  const outputPath = getDefaultCameraOutputPath('<workspace>', new Date('2026-01-01T00:00:00Z'));
  const args = buildCameraSnapshotArgs(platform, undefined, outputPath);
  const ffmpeg = await execFileResult(runtime, 'ffmpeg', ['-version'], options.timeoutMs || 3000);

  if (!ffmpeg.ok) {
    return {
      available: false,
      ffmpegAvailable: false,
      platform,
      commandPreview: buildCommandPreview(args),
      reason: 'ffmpeg is required for local webcam snapshots and was not found on PATH.',
    };
  }

  return {
    available: true,
    ffmpegAvailable: true,
    platform,
    commandPreview: buildCommandPreview(args),
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function runFfmpegSnapshot(
  runtime: CameraRuntime,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean; error?: string }> {
  return new Promise(resolve => {
    const child = runtime.spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;
    let timedOut = false;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: result.ok,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        timedOut,
        error: result.error,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      finish({ ok: false, error: `ffmpeg camera capture timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on('data', chunk => stdout.push(toText(chunk)));
    child.stderr?.on('data', chunk => stderr.push(toText(chunk)));
    child.on('error', error => finish({ ok: false, error: error.message }));
    child.on('close', code => finish({
      ok: code === 0,
      error: code === 0 ? undefined : `ffmpeg exited with code ${code ?? 'unknown'}`,
    }));
  });
}

export async function captureCameraSnapshot(
  options: CameraSnapshotOptions = {},
): Promise<CameraSnapshotResult> {
  const cwd = options.cwd || process.cwd();
  const runtime = options.runtime || defaultRuntime;
  const platform = options.platform || process.platform;
  const timeoutMs = options.timeoutMs || DEFAULT_CAMERA_TIMEOUT_MS;
  const outputPath = path.resolve(cwd, options.outputPath || getDefaultCameraOutputPath(cwd));
  const args = buildCameraSnapshotArgs(platform, options.device, outputPath);
  const command = buildCommandPreview(args);

  await ensureParentDirectory(outputPath);

  const ffmpeg = await execFileResult(runtime, 'ffmpeg', ['-version'], 3000);
  if (!ffmpeg.ok) {
    return {
      success: false,
      command,
      error: 'Cannot capture camera snapshot: ffmpeg was not found on PATH.',
    };
  }

  const result = await runFfmpegSnapshot(runtime, args, timeoutMs);
  if (!result.ok) {
    const details = [result.error, result.stderr.trim(), cameraTroubleshooting(platform)]
      .filter(Boolean)
      .join('\n');
    return {
      success: false,
      command,
      error: details,
      output: result.stdout || result.stderr,
    };
  }

  if (!(await fileExists(outputPath))) {
    return {
      success: false,
      command,
      error: `ffmpeg finished, but no image was written to ${outputPath}.\n${cameraTroubleshooting(platform)}`,
      output: result.stdout || result.stderr,
    };
  }

  let perceptId: string | undefined;
  let perceptPath: string | undefined;
  if (options.recordPercept !== false) {
    try {
      const percept = await recordCompanionPercept({
        modality: 'vision',
        source: 'camera_snapshot',
        summary: `Captured camera snapshot to ${outputPath}`,
        confidence: 1,
        payload: {
          path: outputPath,
          command,
          device: options.device || undefined,
          platform,
          kind: 'image_snapshot',
        },
        tags: ['camera', 'webcam', 'snapshot', 'vision'],
      }, { cwd });
      perceptId = percept.id;
      perceptPath = path.join(cwd, '.codebuddy', 'companion', 'percepts.jsonl');
    } catch {
      // Snapshot success should not be lost if the local percept journal is unavailable.
    }
  }

  return {
    success: true,
    path: outputPath,
    command,
    output: result.stdout || result.stderr || `Saved webcam snapshot to ${outputPath}`,
    perceptId,
    perceptPath,
  };
}

export function formatCameraStatus(status: CameraStatus): string {
  const state = status.available ? '[ok]' : '[todo]';
  const lines = [
    `Camera: ${state} ${status.ffmpegAvailable ? 'ffmpeg available' : 'ffmpeg missing'} on ${status.platform}`,
  ];

  if (status.commandPreview) {
    lines.push(`Preview command: ${status.commandPreview}`);
  }
  if (status.reason) {
    lines.push(`Camera setup: ${status.reason}`);
  }

  return lines.join('\n');
}
