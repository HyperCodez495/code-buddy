/**
 * TTSBridge — Cowork text-to-speech via Piper.
 *
 * Each `synthesize(text)` call spawns the Piper binary one-shot,
 * writes the result to a temp WAV file, reads it back, and returns
 * the bytes to the caller. Piper's startup cost is ~150 ms (model
 * load) so we don't keep a long-running worker like the STT
 * bridge — short-and-simple wins for sub-second latency on typical
 * assistant messages.
 *
 * For very long messages we could later switch to `--output_raw`
 * streaming, but for V1 the one-shot path is plenty.
 *
 * @module main/voice/tts-bridge
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildFilteredSubprocessEnv } from '../../../../src/utils/subprocess-env.js';
import { log, logWarn } from '../utils/logger';

const DEFAULT_VOICE_NAME = 'fr_FR-siwis-medium.onnx';

function voiceStackRoots(): string[] {
  const explicit = process.env.COWORK_VOICE_ROOT;
  return [
    explicit,
    path.join(os.homedir(), 'DEV', 'ai-stack', 'voice'),
    path.join(os.homedir(), 'ai-stack', 'voice'),
    path.join(os.homedir(), '.codebuddy', 'voice'),
  ].filter((item): item is string => Boolean(item));
}

function executableNames(base: string): string[] {
  return process.platform === 'win32'
    ? [`${base}.exe`, `${base}.cmd`, `${base}.bat`, base]
    : [base];
}

function findOnPath(base: string): string | null {
  const pathValue = process.env.PATH || '';
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of executableNames(base)) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolvePiperBinary(): string {
  if (process.env.COWORK_PIPER_BIN) return process.env.COWORK_PIPER_BIN;
  const candidates = [
    ...voiceStackRoots().flatMap(root => [
      path.join(root, 'piper', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
      path.join(root, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
    ]),
    findOnPath('piper'),
  ].filter((item): item is string => Boolean(item));
  return candidates.find(candidate => existsSync(candidate))
    ?? candidates[0]
    ?? (process.platform === 'win32' ? 'piper.exe' : 'piper');
}

function resolvePiperVoice(): string {
  if (process.env.COWORK_PIPER_VOICE) return process.env.COWORK_PIPER_VOICE;
  const candidates = voiceStackRoots().map(root => path.join(root, 'voices', DEFAULT_VOICE_NAME));
  return candidates.find(candidate => existsSync(candidate))
    ?? candidates[0]
    ?? path.join(os.homedir(), '.codebuddy', 'voice', 'voices', DEFAULT_VOICE_NAME);
}

function missingPiperMessage(kind: 'binary' | 'voice', filePath: string): string {
  const envName = kind === 'binary' ? 'COWORK_PIPER_BIN' : 'COWORK_PIPER_VOICE';
  return `${kind === 'binary' ? 'piper binary' : 'piper voice model'} not found at ${filePath}. Set ${envName} or COWORK_VOICE_ROOT to your local voice stack.`;
}

export interface TTSOptions {
  /** Override the Piper binary path. */
  piperBinary?: string;
  /** Override the .onnx voice model. */
  model?: string;
  /** Cap synth time. Default 30 s — Piper crashes after this on bad models. */
  timeoutMs?: number;
  /** Speed multiplier (Piper `--length_scale`). 1.0 = default, >1 slower, <1 faster. */
  lengthScale?: number;
}

export interface TTSResult {
  audio: ArrayBuffer;
  /** Approximate playback duration in ms (synth time != playback time). */
  synthesisDurationMs: number;
  /** Sample rate of the WAV. Piper FR voices are 22050 Hz. */
  sampleRate: number;
}

export class TTSBridge {
  private bootError: string | null = null;
  private resolvedBinary: string;
  private resolvedVoice: string;

  constructor(opts?: { binary?: string; voice?: string }) {
    this.resolvedBinary = opts?.binary ?? resolvePiperBinary();
    this.resolvedVoice = opts?.voice ?? resolvePiperVoice();
    if (!existsSync(this.resolvedBinary)) {
      this.bootError = missingPiperMessage('binary', this.resolvedBinary);
      logWarn('[TTSBridge]', this.bootError);
    } else if (!existsSync(this.resolvedVoice)) {
      this.bootError = missingPiperMessage('voice', this.resolvedVoice);
      logWarn('[TTSBridge]', this.bootError);
    } else {
      log(
        `[TTSBridge] ready — binary=${this.resolvedBinary} voice=${path.basename(
          this.resolvedVoice,
        )}`,
      );
    }
  }

  isReady(): boolean {
    return this.bootError === null;
  }

  getBootError(): string | null {
    return this.bootError;
  }

  /**
   * Synthesise `text` to speech. Throws on Piper failure / timeout.
   * The caller (renderer) is expected to play the returned bytes.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('TTSBridge: text is empty');
    }
    if (this.bootError) {
      throw new Error(this.bootError);
    }
    const binary = options.piperBinary ?? this.resolvedBinary;
    const voice = options.model ?? this.resolvedVoice;
    const timeoutMs = options.timeoutMs ?? 30000;

    // Strip markdown / control noise so Piper doesn't read backticks
    // and underscores aloud. Cheap heuristic — for richer cleanup the
    // renderer should pre-process before calling.
    const cleaned = sanitizeForSpeech(text);
    if (!cleaned) {
      throw new Error('TTSBridge: text is empty after sanitization');
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cowork-tts-'));
    const outPath = path.join(tmpDir, 'speech.wav');

    const args = [
      '--model',
      voice,
      '--output_file',
      outPath,
      '--quiet',
    ];
    if (typeof options.lengthScale === 'number' && options.lengthScale > 0) {
      args.push('--length_scale', String(options.lengthScale));
    }

    const startedAt = Date.now();
    await spawnPiper(binary, args, cleaned, timeoutMs);
    const synthesisDurationMs = Date.now() - startedAt;

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(outPath);
    } finally {
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const sampleRate = readWavSampleRate(bytes) ?? 22050;
    const audio = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return {
      audio: audio as ArrayBuffer,
      synthesisDurationMs,
      sampleRate,
    };
  }
}

function spawnPiper(
  binary: string,
  args: string[],
  text: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildPiperEnv(),
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const killer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      reject(new Error(`piper timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.split('\n').slice(-3).join(' | ').trim();
        reject(
          new Error(
            `piper exited with code ${code ?? '?'}${tail ? ` — ${tail}` : ''}`,
          ),
        );
      }
    });
    child.stdin.write(text + '\n');
    child.stdin.end();
  });
}

function buildPiperEnv(): NodeJS.ProcessEnv {
  return buildFilteredSubprocessEnv({
    allowEnv: ['COWORK_VOICE_ROOT'],
  });
}

/**
 * Parse the RIFF/WAVE header to extract the sample rate. Returns
 * `null` for malformed input. Covers only the canonical PCM header
 * Piper produces (22050 Hz mono 16-bit).
 */
function readWavSampleRate(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  // `fmt ` chunk: byte 24 = sampleRate (little-endian u32).
  return buf.readUInt32LE(24);
}

/**
 * Make text suitable for TTS playback. Removes markdown noise that
 * Piper would otherwise read aloud, and elides code blocks (no point
 * speaking 100 lines of bash).
 */
function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (bloc de code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export const __test = {
  sanitizeForSpeech,
  readWavSampleRate,
  resolvePiperBinary,
  resolvePiperVoice,
  missingPiperMessage,
  buildPiperEnv,
};
