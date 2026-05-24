import { spawn as nodeSpawn, execFile as nodeExecFile } from 'child_process';
import { mkdir, stat, writeFile } from 'fs/promises';
import * as path from 'path';
import { recordCompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';

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

export interface CameraRendererSnapshotOptions {
  cwd?: string;
  outputPath?: string;
  dataUrl?: string;
  base64?: string;
  mediaType?: string;
  width?: number;
  height?: number;
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

export interface CameraSnapshotInspectionOptions extends CameraSnapshotOptions {
  imagePath?: string;
  includeOcr?: boolean;
  ocrLanguage?: string;
}

export interface CameraImageAnalysis {
  description: string;
  labels: string[];
  dimensions?: { width: number; height: number };
  format?: string;
  size?: number;
  channels?: number;
}

export interface CameraSnapshotInspectionResult {
  success: boolean;
  path?: string;
  snapshot?: CameraSnapshotResult;
  analysis?: CameraImageAnalysis;
  ocrText?: string;
  summary?: string;
  error?: string;
  perceptId?: string;
  safetyEventId?: string;
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

function extensionForMediaType(mediaType: string | undefined): string {
  if (mediaType === 'image/jpeg' || mediaType === 'image/jpg') return 'jpg';
  if (mediaType === 'image/webp') return 'webp';
  return 'png';
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

export function getDefaultCameraOutputPath(
  cwd = process.cwd(),
  date = new Date(),
  extension = 'png',
): string {
  const stamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return path.join(cwd, '.codebuddy', 'camera', `camera-${stamp}.${extension}`);
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

function decodeRendererImage(options: CameraRendererSnapshotOptions): {
  buffer: Buffer;
  mediaType: string;
} {
  if (options.dataUrl) {
    const match = options.dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      throw new Error('Renderer camera snapshot must be a base64 PNG, JPEG, or WEBP data URL.');
    }
    return {
      mediaType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
      buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
    };
  }

  if (!options.base64) {
    throw new Error('Renderer camera snapshot requires dataUrl or base64 image data.');
  }

  const mediaType = options.mediaType === 'image/jpg' ? 'image/jpeg' : options.mediaType;
  if (!mediaType || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
    throw new Error('Renderer camera snapshot base64 data requires mediaType image/png, image/jpeg, or image/webp.');
  }

  return {
    mediaType,
    buffer: Buffer.from(options.base64.replace(/\s/g, ''), 'base64'),
  };
}

export async function importCameraSnapshot(
  options: CameraRendererSnapshotOptions,
): Promise<CameraSnapshotResult> {
  const cwd = options.cwd || process.cwd();
  let decoded: { buffer: Buffer; mediaType: string };

  try {
    decoded = decodeRendererImage(options);
  } catch (err) {
    return {
      success: false,
      command: 'renderer-getUserMedia',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (decoded.buffer.length === 0) {
    return {
      success: false,
      command: 'renderer-getUserMedia',
      error: 'Renderer camera snapshot was empty.',
    };
  }

  const extension = extensionForMediaType(decoded.mediaType);
  const outputPath = path.resolve(
    cwd,
    options.outputPath || getDefaultCameraOutputPath(cwd, new Date(), extension),
  );

  await ensureParentDirectory(outputPath);
  await writeFile(outputPath, decoded.buffer);

  let perceptId: string | undefined;
  let perceptPath: string | undefined;
  if (options.recordPercept !== false) {
    try {
      const percept = await recordCompanionPercept({
        modality: 'vision',
        source: 'camera_snapshot',
        summary: `Captured renderer camera snapshot to ${outputPath}`,
        confidence: 1,
        payload: {
          path: outputPath,
          command: 'renderer-getUserMedia',
          mediaType: decoded.mediaType,
          width: options.width,
          height: options.height,
          kind: 'image_snapshot',
          captureSource: 'electron_renderer',
        },
        tags: ['camera', 'webcam', 'snapshot', 'vision', 'renderer'],
      }, { cwd });
      perceptId = percept.id;
      perceptPath = path.join(cwd, '.codebuddy', 'companion', 'percepts.jsonl');
    } catch {
      // Snapshot success should not depend on the local percept journal.
    }
  }

  try {
    await recordCompanionSafetyEvent({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
      reason: 'Captured an explicit Electron renderer webcam frame for Buddy vision.',
      status: 'completed',
      source: 'camera_snapshot',
      artifactPath: outputPath,
      payload: {
        path: outputPath,
        command: 'renderer-getUserMedia',
        mediaType: decoded.mediaType,
        width: options.width,
        height: options.height,
        captureSource: 'electron_renderer',
      },
      tags: ['camera', 'webcam', 'vision', 'renderer'],
    }, { cwd });
  } catch {
    // Camera capture is complete; the percept journal still records the user-visible result.
  }

  return {
    success: true,
    path: outputPath,
    command: 'renderer-getUserMedia',
    output: `Saved renderer webcam snapshot to ${outputPath}`,
    perceptId,
    perceptPath,
  };
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

  try {
    await recordCompanionSafetyEvent({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
      reason: 'Captured an explicit local webcam frame for Buddy vision.',
      status: 'completed',
      source: 'camera_snapshot',
      artifactPath: outputPath,
      payload: {
        path: outputPath,
        command,
        device: options.device || undefined,
        platform,
      },
      tags: ['camera', 'webcam', 'vision'],
    }, { cwd });
  } catch {
    // Camera capture is complete; the percept journal still records the user-visible result.
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

async function analyzeImage(imagePath: string): Promise<CameraImageAnalysis> {
  const { ImageProcessorTool } = await import('../tools/vision/image-processor.js');
  const processor = ImageProcessorTool.getInstance();
  return processor.analyze(imagePath);
}

async function extractOcrText(imagePath: string, language: string): Promise<string> {
  const { OcrTool } = await import('../tools/vision/ocr-tool.js');
  const ocr = OcrTool.getInstance();
  return ocr.extractText(imagePath, language);
}

function summarizeInspection(
  imagePath: string,
  analysis: CameraImageAnalysis,
  ocrText: string | undefined,
): string {
  const dimensions = analysis.dimensions
    ? `${analysis.dimensions.width}x${analysis.dimensions.height}`
    : 'unknown dimensions';
  const bits = [
    `Inspected camera image ${path.basename(imagePath)} (${dimensions}, ${analysis.format || 'unknown format'})`,
  ];
  if (typeof analysis.size === 'number') bits.push(`${Math.round(analysis.size / 1024)} KB`);
  if (ocrText && ocrText.trim()) bits.push(`OCR text: ${ocrText.trim().slice(0, 160)}`);
  return bits.join('; ');
}

export async function inspectCameraSnapshot(
  options: CameraSnapshotInspectionOptions = {},
): Promise<CameraSnapshotInspectionResult> {
  const cwd = options.cwd || process.cwd();
  let imagePath = options.imagePath ? path.resolve(cwd, options.imagePath) : undefined;
  let snapshot: CameraSnapshotResult | undefined;

  if (!imagePath) {
    snapshot = await captureCameraSnapshot({
      ...options,
      cwd,
      recordPercept: false,
    });
    if (!snapshot.success || !snapshot.path) {
      return {
        success: false,
        snapshot,
        error: snapshot.error || 'camera snapshot failed before inspection',
      };
    }
    imagePath = snapshot.path;
  }

  try {
    const analysis = await analyzeImage(imagePath);
    const ocrText = options.includeOcr
      ? await extractOcrText(imagePath, options.ocrLanguage || 'eng')
      : undefined;
    const summary = summarizeInspection(imagePath, analysis, ocrText);

    let perceptId: string | undefined;
    if (options.recordPercept !== false) {
      try {
        const percept = await recordCompanionPercept({
          modality: 'vision',
          source: 'camera_inspection',
          summary,
          confidence: 0.9,
          payload: {
            path: imagePath,
            analysis,
            ocrTextPreview: ocrText?.slice(0, 1000),
            includeOcr: Boolean(options.includeOcr),
            snapshotPerceptId: snapshot?.perceptId,
          },
          tags: ['camera', 'vision', 'inspection', ...(analysis.labels || [])],
        }, { cwd });
        perceptId = percept.id;
      } catch {
        // Inspection result remains useful even if the percept journal is unavailable.
      }
    }

    let safetyEventId: string | undefined;
    try {
      const event = await recordCompanionSafetyEvent({
        kind: 'sense',
        risk: 'medium',
        action: 'camera_inspection',
        reason: 'Inspected a local camera image for Buddy vision metadata.',
        status: 'completed',
        source: 'camera_inspection',
        artifactPath: imagePath,
        payload: {
          path: imagePath,
          includeOcr: Boolean(options.includeOcr),
          perceptId,
          dimensions: analysis.dimensions,
          format: analysis.format,
        },
        tags: ['camera', 'vision', 'inspection'],
      }, { cwd });
      safetyEventId = event.id;
    } catch {
      // Do not fail a successful inspection if the audit append fails.
    }

    return {
      success: true,
      path: imagePath,
      snapshot,
      analysis,
      ocrText,
      summary,
      perceptId,
      safetyEventId,
    };
  } catch (err) {
    return {
      success: false,
      path: imagePath,
      snapshot,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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

export function formatCameraSnapshotInspection(result: CameraSnapshotInspectionResult): string {
  if (!result.success) {
    return [
      'Camera inspection failed.',
      result.error || 'Unknown error.',
      result.path ? `Image: ${result.path}` : '',
    ].filter(Boolean).join('\n');
  }

  const dimensions = result.analysis?.dimensions
    ? `${result.analysis.dimensions.width}x${result.analysis.dimensions.height}`
    : 'unknown';
  const lines = [
    'Camera Inspection',
    '='.repeat(50),
    '',
    `Image: ${result.path}`,
    `Summary: ${result.summary}`,
    `Dimensions: ${dimensions}`,
    `Format: ${result.analysis?.format || 'unknown'}`,
  ];
  if (result.ocrText) lines.push('', 'OCR:', result.ocrText);
  if (result.perceptId) lines.push('', `Percept: ${result.perceptId}`);
  if (result.safetyEventId) lines.push(`Safety event: ${result.safetyEventId}`);
  return lines.join('\n');
}
