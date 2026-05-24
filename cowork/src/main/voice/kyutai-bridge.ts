/**
 * KyutaiBridge — optional low-latency DSM voice path.
 *
 * Kyutai's moshi-server exposes STT/TTS over WebSocket with small
 * MessagePack frames:
 * - STT: /api/asr-streaming receives { type: "Audio", pcm: float[] }
 * - TTS: /api/tts_streaming receives { type: "Text", text }, then Eos
 *
 * This bridge intentionally has no npm dependency on a MessagePack
 * package. It implements the tiny subset needed by the public Kyutai
 * scripts so Cowork can keep Piper/faster-whisper as zero-config
 * fallbacks and enable Kyutai only when explicitly requested.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import { log } from '../utils/logger';

const SAMPLE_RATE = 24000;
const FRAME_SIZE = 1920;
const DEFAULT_BASE_URL = 'ws://127.0.0.1:8080';
const DEFAULT_API_KEY = 'public_token';
const DEFAULT_TTS_VOICE = 'expresso/ex03-ex01_happy_001_channel1_334s.wav';

export interface KyutaiBridgeOptions {
  baseUrl?: string;
  apiKey?: string;
  ffmpegBinary?: string;
  ttsVoice?: string;
  timeoutMs?: number;
}

export interface KyutaiWord {
  text: string;
  startTime?: number;
  stopTime?: number;
}

export interface KyutaiTranscriptionResult {
  text: string;
  durationMs: number;
  words: KyutaiWord[];
  vadSteps: number;
}

export interface KyutaiTTSResult {
  audio: ArrayBuffer;
  synthesisDurationMs: number;
  sampleRate: number;
}

export interface KyutaiStatus {
  sttEnabled: boolean;
  ttsEnabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  ffmpegBinary: string;
  ttsVoice: string;
}

export interface KyutaiEndpointProbe {
  ok: boolean;
  endpoint: string;
  durationMs: number;
  error?: string;
}

export interface KyutaiDiagnostics extends KyutaiStatus {
  ffmpegFound: boolean;
  sttProbe?: KyutaiEndpointProbe;
  ttsProbe?: KyutaiEndpointProbe;
}

function providerEnabled(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'kyutai' || normalized === 'dsm' || normalized === 'moshi';
}

export function isKyutaiSttEnabled(): boolean {
  return providerEnabled(process.env.COWORK_STT_PROVIDER)
    || providerEnabled(process.env.COWORK_VOICE_PROVIDER);
}

export function isKyutaiTtsEnabled(): boolean {
  return providerEnabled(process.env.COWORK_TTS_PROVIDER)
    || providerEnabled(process.env.COWORK_VOICE_PROVIDER);
}

function normalizeBaseUrl(url: string | undefined): string {
  const raw = (url || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (raw.startsWith('http://')) return `ws://${raw.slice('http://'.length)}`;
  if (raw.startsWith('https://')) return `wss://${raw.slice('https://'.length)}`;
  return raw;
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

function resolveFfmpegBinary(override?: string): string {
  return override
    || process.env.COWORK_FFMPEG_BIN
    || process.env.FFMPEG_BIN
    || findOnPath('ffmpeg')
    || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= 31) return Buffer.concat([Buffer.from([0xa0 | bytes.length]), bytes]);
  if (bytes.length <= 0xff) return Buffer.concat([Buffer.from([0xd9, bytes.length]), bytes]);
  if (bytes.length <= 0xffff) {
    const header = Buffer.allocUnsafe(3);
    header[0] = 0xda;
    header.writeUInt16BE(bytes.length, 1);
    return Buffer.concat([header, bytes]);
  }
  const header = Buffer.allocUnsafe(5);
  header[0] = 0xdb;
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

function encodeArrayHeader(length: number): Buffer {
  if (length <= 15) return Buffer.from([0x90 | length]);
  if (length <= 0xffff) {
    const header = Buffer.allocUnsafe(3);
    header[0] = 0xdc;
    header.writeUInt16BE(length, 1);
    return header;
  }
  const header = Buffer.allocUnsafe(5);
  header[0] = 0xdd;
  header.writeUInt32BE(length, 1);
  return header;
}

function encodeMapHeader(length: number): Buffer {
  if (length <= 15) return Buffer.from([0x80 | length]);
  if (length <= 0xffff) {
    const header = Buffer.allocUnsafe(3);
    header[0] = 0xde;
    header.writeUInt16BE(length, 1);
    return header;
  }
  const header = Buffer.allocUnsafe(5);
  header[0] = 0xdf;
  header.writeUInt32BE(length, 1);
  return header;
}

function encodeNumber(value: number): Buffer {
  if (Number.isInteger(value)) {
    if (value >= 0 && value <= 0x7f) return Buffer.from([value]);
    if (value >= -32 && value < 0) return Buffer.from([0xe0 | (value + 32)]);
    if (value >= 0 && value <= 0xff) return Buffer.from([0xcc, value]);
    if (value >= 0 && value <= 0xffff) {
      const buf = Buffer.allocUnsafe(3);
      buf[0] = 0xcd;
      buf.writeUInt16BE(value, 1);
      return buf;
    }
    if (value >= 0 && value <= 0xffffffff) {
      const buf = Buffer.allocUnsafe(5);
      buf[0] = 0xce;
      buf.writeUInt32BE(value, 1);
      return buf;
    }
    if (value >= -0x80 && value < 0) {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xd0;
      buf.writeInt8(value, 1);
      return buf;
    }
    if (value >= -0x8000 && value < 0) {
      const buf = Buffer.allocUnsafe(3);
      buf[0] = 0xd1;
      buf.writeInt16BE(value, 1);
      return buf;
    }
    if (value >= -0x80000000 && value < 0) {
      const buf = Buffer.allocUnsafe(5);
      buf[0] = 0xd2;
      buf.writeInt32BE(value, 1);
      return buf;
    }
  }

  const buf = Buffer.allocUnsafe(5);
  buf[0] = 0xca;
  buf.writeFloatBE(value, 1);
  return buf;
}

function encodeMsgPack(value: unknown): Buffer {
  if (value === null || value === undefined) return Buffer.from([0xc0]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xc3 : 0xc2]);
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value) || value instanceof Float32Array) {
    const items = Array.from(value as ArrayLike<unknown>);
    return Buffer.concat([encodeArrayHeader(items.length), ...items.map(encodeMsgPack)]);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined);
    const chunks = [encodeMapHeader(entries.length)];
    for (const [key, item] of entries) {
      chunks.push(encodeString(key), encodeMsgPack(item));
    }
    return Buffer.concat(chunks);
  }
  throw new Error(`unsupported MessagePack value: ${typeof value}`);
}

class MsgPackReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  read(): unknown {
    const prefix = this.readUInt8();
    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0xe0) return prefix - 0x100;
    if ((prefix & 0xe0) === 0xa0) return this.readString(prefix & 0x1f);
    if ((prefix & 0xf0) === 0x90) return this.readArray(prefix & 0x0f);
    if ((prefix & 0xf0) === 0x80) return this.readMap(prefix & 0x0f);

    switch (prefix) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: return this.readFloat32();
      case 0xcb: return this.readFloat64();
      case 0xcc: return this.readUInt8();
      case 0xcd: return this.readUInt16();
      case 0xce: return this.readUInt32();
      case 0xd0: return this.readInt8();
      case 0xd1: return this.readInt16();
      case 0xd2: return this.readInt32();
      case 0xd9: return this.readString(this.readUInt8());
      case 0xda: return this.readString(this.readUInt16());
      case 0xdb: return this.readString(this.readUInt32());
      case 0xdc: return this.readArray(this.readUInt16());
      case 0xdd: return this.readArray(this.readUInt32());
      case 0xde: return this.readMap(this.readUInt16());
      case 0xdf: return this.readMap(this.readUInt32());
      case 0xc4: return this.readBuffer(this.readUInt8());
      case 0xc5: return this.readBuffer(this.readUInt16());
      case 0xc6: return this.readBuffer(this.readUInt32());
      default:
        throw new Error(`unsupported MessagePack prefix 0x${prefix.toString(16)}`);
    }
  }

  private ensure(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new Error('truncated MessagePack payload');
    }
  }

  private readUInt8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readInt8(): number {
    this.ensure(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUInt16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  private readInt16(): number {
    this.ensure(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  private readUInt32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  private readInt32(): number {
    this.ensure(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  private readFloat32(): number {
    this.ensure(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  private readFloat64(): number {
    this.ensure(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  private readString(length: number): string {
    const bytes = this.readBuffer(length);
    return bytes.toString('utf8');
  }

  private readBuffer(length: number): Buffer {
    this.ensure(length);
    const bytes = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  private readArray(length: number): unknown[] {
    const items: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
      items.push(this.read());
    }
    return items;
  }

  private readMap(length: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < length; i += 1) {
      const key = this.read();
      if (typeof key !== 'string') {
        throw new Error('MessagePack map key must be a string');
      }
      map[key] = this.read();
    }
    return map;
  }
}

function decodeMsgPack(buffer: Buffer): unknown {
  return new MsgPackReader(buffer).read();
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number');
}

function compactTranscript(words: KyutaiWord[]): string {
  return words
    .map(word => word.text)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function float32FromBufferLE(bytes: Buffer): Float32Array {
  if (bytes.length % 4 !== 0) {
    throw new Error(`ffmpeg produced ${bytes.length} bytes, not a float32 stream`);
  }
  const values = new Float32Array(bytes.length / 4);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = bytes.readFloatLE(i * 4);
  }
  return values;
}

function clampPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function buildPcm16Wav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    wav.writeInt16LE(clampPcm16(samples[i] ?? 0), 44 + i * bytesPerSample);
  }
  return wav;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    const killer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', err => {
      clearTimeout(killer);
      reject(err);
    });
    child.on('exit', code => {
      clearTimeout(killer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdout), stderr });
      } else {
        const tail = stderr.split('\n').slice(-4).join(' | ').trim();
        reject(new Error(`${path.basename(command)} exited with code ${code ?? '?'}${tail ? `: ${tail}` : ''}`));
      }
    });
  });
}

function wsSend(ws: WebSocket, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(payload, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

async function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    }),
    timeoutMs,
    'Kyutai websocket open',
  );
}

export class KyutaiBridge {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly ffmpegBinary: string;
  private readonly ttsVoice: string;
  private readonly timeoutMs: number;

  constructor(options: KyutaiBridgeOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.COWORK_KYUTAI_URL);
    this.apiKey = options.apiKey ?? process.env.COWORK_KYUTAI_API_KEY ?? DEFAULT_API_KEY;
    this.ffmpegBinary = resolveFfmpegBinary(options.ffmpegBinary);
    this.ttsVoice = options.ttsVoice ?? process.env.COWORK_KYUTAI_TTS_VOICE ?? DEFAULT_TTS_VOICE;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.COWORK_KYUTAI_TIMEOUT_MS || 90000);
  }

  isSttEnabled(): boolean {
    return isKyutaiSttEnabled();
  }

  isTtsEnabled(): boolean {
    return isKyutaiTtsEnabled();
  }

  status(): KyutaiStatus {
    return {
      sttEnabled: this.isSttEnabled(),
      ttsEnabled: this.isTtsEnabled(),
      baseUrl: this.baseUrl,
      apiKeyConfigured: this.apiKey !== DEFAULT_API_KEY,
      ffmpegBinary: this.ffmpegBinary,
      ttsVoice: this.ttsVoice,
    };
  }

  async diagnostics(options: {
    includeStt?: boolean;
    includeTts?: boolean;
    timeoutMs?: number;
  } = {}): Promise<KyutaiDiagnostics> {
    const status = this.status();
    const timeoutMs = Math.max(100, options.timeoutMs ?? 750);
    const shouldProbeStt = options.includeStt !== false && status.sttEnabled;
    const shouldProbeTts = options.includeTts !== false && status.ttsEnabled;

    return {
      ...status,
      ffmpegFound: this.ffmpegBinary === 'ffmpeg' || this.ffmpegBinary === 'ffmpeg.exe'
        ? Boolean(findOnPath('ffmpeg'))
        : existsSync(this.ffmpegBinary),
      sttProbe: shouldProbeStt
        ? await this.probeEndpoint('/api/asr-streaming', timeoutMs)
        : undefined,
      ttsProbe: shouldProbeTts
        ? await this.probeEndpoint(`/api/tts_streaming?${new URLSearchParams({
          voice: this.ttsVoice,
          format: 'PcmMessagePack',
        }).toString()}`, timeoutMs)
        : undefined,
    };
  }

  async transcribe(
    audioBuffer: Buffer,
    options: { language?: string; timeoutMs?: number } = {},
  ): Promise<KyutaiTranscriptionResult> {
    const startedAt = Date.now();
    const pcm = await this.convertAudioToPcm(audioBuffer, options.timeoutMs ?? 30000);
    const words = await this.transcribePcm(pcm, options.timeoutMs ?? this.timeoutMs);
    return {
      text: compactTranscript(words.words),
      durationMs: Date.now() - startedAt,
      words: words.words,
      vadSteps: words.vadSteps,
    };
  }

  async synthesize(text: string, options: { timeoutMs?: number; voice?: string } = {}): Promise<KyutaiTTSResult> {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Kyutai TTS text is empty');
    const startedAt = Date.now();
    const samples = await this.synthesizePcm(clean, options.timeoutMs ?? this.timeoutMs, options.voice);
    const wav = buildPcm16Wav(samples);
    const audio = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
    return {
      audio: audio as ArrayBuffer,
      synthesisDurationMs: Date.now() - startedAt,
      sampleRate: SAMPLE_RATE,
    };
  }

  private async convertAudioToPcm(audioBuffer: Buffer, timeoutMs: number): Promise<Float32Array> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cowork-kyutai-'));
    const inputPath = path.join(tmpDir, 'clip.webm');
    const outputPath = path.join(tmpDir, 'clip.f32le');
    try {
      await fs.writeFile(inputPath, audioBuffer);
      await runProcess(this.ffmpegBinary, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        outputPath,
      ], timeoutMs);
      return float32FromBufferLE(await fs.readFile(outputPath));
    } finally {
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async transcribePcm(
    pcm: Float32Array,
    timeoutMs: number,
  ): Promise<{ words: KyutaiWord[]; vadSteps: number }> {
    const url = `${this.baseUrl}/api/asr-streaming`;
    const ws = new WebSocket(url, {
      headers: { 'kyutai-api-key': this.apiKey },
    });
    const words: KyutaiWord[] = [];
    let vadSteps = 0;

    const receive = new Promise<{ words: KyutaiWord[]; vadSteps: number }>((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          const message = decodeMsgPack(rawDataToBuffer(data));
          if (!message || typeof message !== 'object') return;
          const frame = message as Record<string, unknown>;
          if (frame.type === 'Step') {
            vadSteps += 1;
            return;
          }
          if (frame.type === 'Word' && typeof frame.text === 'string') {
            words.push({
              text: frame.text,
              startTime: typeof frame.start_time === 'number' ? frame.start_time : undefined,
            });
            return;
          }
          if (frame.type === 'EndWord' && words.length > 0) {
            const last = words[words.length - 1];
            if (last && typeof frame.stop_time === 'number') {
              last.stopTime = frame.stop_time;
            }
            return;
          }
          if (frame.type === 'Marker') {
            resolve({ words, vadSteps });
            ws.close();
          }
        } catch (err) {
          reject(err);
          ws.close();
        }
      });
      ws.once('error', reject);
      ws.once('close', () => {
        if (words.length > 0) resolve({ words, vadSteps });
      });
    });

    await waitForOpen(ws, timeoutMs);
    await this.sendSttAudio(ws, pcm);
    return withTimeout(receive, timeoutMs, 'Kyutai STT');
  }

  private async probeEndpoint(pathname: string, timeoutMs: number): Promise<KyutaiEndpointProbe> {
    const endpoint = `${this.baseUrl}${pathname}`;
    const startedAt = Date.now();
    const ws = new WebSocket(endpoint, {
      headers: { 'kyutai-api-key': this.apiKey },
    });
    ws.on('error', () => undefined);

    try {
      await waitForOpen(ws, timeoutMs);
      return {
        ok: true,
        endpoint,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ok: false,
        endpoint,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
  }

  private async sendSttAudio(ws: WebSocket, pcm: Float32Array): Promise<void> {
    const sendAudio = async (samples: Float32Array | number[]): Promise<void> => {
      await wsSend(ws, encodeMsgPack({ type: 'Audio', pcm: Array.from(samples) }));
    };
    const silence = new Float32Array(SAMPLE_RATE);
    await sendAudio(silence);
    for (let offset = 0; offset < pcm.length; offset += FRAME_SIZE) {
      await sendAudio(pcm.subarray(offset, offset + FRAME_SIZE));
    }
    const trailingSilenceSeconds = Math.max(1, Number(process.env.COWORK_KYUTAI_TRAILING_SILENCE_SEC || 4));
    for (let i = 0; i < trailingSilenceSeconds; i += 1) {
      await sendAudio(silence);
    }
    await wsSend(ws, encodeMsgPack({ type: 'Marker', id: 0 }));
    for (let i = 0; i < trailingSilenceSeconds; i += 1) {
      await sendAudio(silence);
    }
  }

  private async synthesizePcm(text: string, timeoutMs: number, voice?: string): Promise<Float32Array> {
    const params = new URLSearchParams({
      voice: voice ?? this.ttsVoice,
      format: 'PcmMessagePack',
    });
    const url = `${this.baseUrl}/api/tts_streaming?${params.toString()}`;
    const ws = new WebSocket(url, {
      headers: { 'kyutai-api-key': this.apiKey },
    });
    const chunks: Float32Array[] = [];
    const receive = new Promise<Float32Array>((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          const message = decodeMsgPack(rawDataToBuffer(data));
          if (!message || typeof message !== 'object') return;
          const frame = message as Record<string, unknown>;
          if (frame.type === 'Audio') {
            chunks.push(Float32Array.from(numberArray(frame.pcm)));
          }
        } catch (err) {
          reject(err);
          ws.close();
        }
      });
      ws.once('error', reject);
      ws.once('close', () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(joined);
      });
    });

    await waitForOpen(ws, timeoutMs);
    log(`[KyutaiBridge] streaming TTS to ${this.baseUrl}`);
    for (const word of text.split(/\s+/).filter(Boolean)) {
      await wsSend(ws, encodeMsgPack({ type: 'Text', text: word }));
    }
    await wsSend(ws, encodeMsgPack({ type: 'Eos' }));
    return withTimeout(receive, timeoutMs, 'Kyutai TTS');
  }
}

export const __test = {
  SAMPLE_RATE,
  buildPcm16Wav,
  compactTranscript,
  decodeMsgPack,
  encodeMsgPack,
  float32FromBufferLE,
  normalizeBaseUrl,
  providerEnabled,
};
