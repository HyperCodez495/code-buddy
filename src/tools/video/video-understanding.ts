/**
 * Video understanding orchestrator (Phase 1: transcript-first, local-first).
 *
 * Resolves a source (YouTube URL / direct media URL / local file) to a timestamped
 * transcript via a gracefully-degrading cascade:
 *   YouTube  → free captions first, else yt-dlp audio download + local Whisper;
 *   direct URL → yt-dlp audio download + local Whisper;
 *   local file → ffmpeg audio extract + local Whisper.
 *
 * It NEVER calls an LLM — it returns the structured, persisted transcript plus a
 * bounded text rendering; the main agent does the summarizing / question-answering.
 * Every failure surfaces as `{ error }`; nothing throws.
 *
 * @module tools/video/video-understanding
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync as realExistsSync } from 'fs';
import { basename, join, isAbsolute, resolve as resolvePath } from 'path';
import type { ToolResult } from '../../types/index.js';
import type { Transcriber } from '../../sensory/speech-reaction.js';
import { logger } from '../../utils/logger.js';
import {
  fetchYoutubeCaptions,
  extractYoutubeVideoId,
  isYoutubeUrl,
  type Segment,
} from './youtube-captions.js';
import { downloadAudioWav, isDownloadOk, type DownloadResult } from './media-fetch.js';
import { transcribeLong, type TimedSegment, type LongTranscribeOptions } from './long-transcribe.js';

export type UnderstandMethod = 'youtube-captions' | 'youtube-audio' | 'local-file' | 'direct-url';

export interface UnderstandVideoInput {
  source: string;
  question?: string;
  language?: string;
}

export interface UnderstandVideoSuccess {
  segments: TimedSegment[];
  transcriptPath: string;
  source: string;
  method: UnderstandMethod;
  output: string;
}

export interface UnderstandVideoFailure {
  error: string;
}

export type UnderstandVideoResult = UnderstandVideoSuccess | UnderstandVideoFailure;

export interface UnderstandVideoDeps {
  cwd?: string;
  /** Directory for the downloaded audio + persisted transcript (default `<cwd>/.codebuddy/video`). */
  outDir?: string;
  fetchCaptions?: typeof fetchYoutubeCaptions;
  downloadAudio?: (source: string, outDir: string) => Promise<DownloadResult>;
  /** Local-file audio extraction (default: `VideoTool.extractAudio`). */
  extractAudio?: (filePath: string) => Promise<ToolResult>;
  transcribeLong?: (audioPath: string, options?: LongTranscribeOptions) => Promise<TimedSegment[]>;
  /** Injectable STT handed to the default `transcribeLong`. */
  transcriber?: Transcriber;
  existsSync?: (path: string) => boolean;
  now?: () => number;
  /** Max chars of transcript rendered inline before truncating with a pointer to the file. */
  maxOutputChars?: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 6000;

/** Type guard: did understanding succeed? */
export function isUnderstandOk(result: UnderstandVideoResult): result is UnderstandVideoSuccess {
  return 'segments' in result;
}

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** Captions carry (start, duration); fold into the shared (t_start, t_end, said) shape. */
function captionsToSegments(captions: Segment[]): TimedSegment[] {
  return captions.map((cue) => ({
    t_start: Math.round(cue.start * 100) / 100,
    t_end: Math.round((cue.start + cue.duration) * 100) / 100,
    said: cue.text,
  }));
}

function renderTranscript(segments: TimedSegment[]): string {
  return segments
    .map((seg) => `[${formatTimestamp(seg.t_start)} - ${formatTimestamp(seg.t_end)}] ${seg.said}`)
    .join('\n');
}

function safeSlug(source: string): string {
  const id = extractYoutubeVideoId(source);
  if (id) return `yt-${id}`;
  const base = basename(source.split(/[?#]/)[0] ?? source).replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || `video-${Date.now()}`;
}

async function resolveSegments(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps,
  outDir: string,
): Promise<{ segments: TimedSegment[]; method: UnderstandMethod } | UnderstandVideoFailure> {
  const source = input.source;
  const fetchCaptions = deps.fetchCaptions ?? fetchYoutubeCaptions;
  const downloadAudio = deps.downloadAudio ?? ((s: string, d: string) => downloadAudioWav(s, d));
  const runTranscribe = deps.transcribeLong
    ?? ((audioPath: string, opts?: LongTranscribeOptions) => transcribeLong(audioPath, opts));
  const existsSync = deps.existsSync ?? realExistsSync;
  const transcribeOpts: LongTranscribeOptions = deps.transcriber ? { transcriber: deps.transcriber } : {};

  const langs = [input.language, 'en', 'fr'].filter((l): l is string => !!l && l.trim().length > 0);
  const uniqueLangs = [...new Set(langs)];

  // --- YouTube: captions first, then audio download + local STT ---
  if (isYoutubeUrl(source)) {
    const captions = await fetchCaptions(source, uniqueLangs);
    if (captions && captions.length > 0) {
      return { segments: captionsToSegments(captions), method: 'youtube-captions' };
    }
    logger.info('[video] no captions — falling back to yt-dlp + local STT');
    const dl = await downloadAudio(source, outDir);
    if (!isDownloadOk(dl)) return { error: dl.error };
    return { segments: await runTranscribe(dl.wavPath, transcribeOpts), method: 'youtube-audio' };
  }

  // --- Local file: ffmpeg audio extract + local STT ---
  const localPath = isAbsolute(source) ? source : resolvePath(deps.cwd ?? process.cwd(), source);
  if (existsSync(source) || existsSync(localPath)) {
    const extract = deps.extractAudio ?? (await defaultExtractAudio());
    const extracted = await extract(existsSync(source) ? source : localPath);
    if (!extracted.success) {
      return { error: extracted.error ?? 'audio extraction failed' };
    }
    const audioPath = (extracted.data as { path?: string } | undefined)?.path;
    if (!audioPath) return { error: 'audio extraction produced no output path' };
    return { segments: await runTranscribe(audioPath, transcribeOpts), method: 'local-file' };
  }

  // --- Direct media URL: yt-dlp handles generic URLs too ---
  if (/^https?:\/\//i.test(source)) {
    const dl = await downloadAudio(source, outDir);
    if (!isDownloadOk(dl)) return { error: dl.error };
    return { segments: await runTranscribe(dl.wavPath, transcribeOpts), method: 'direct-url' };
  }

  return { error: `source introuvable (ni fichier local, ni URL): ${source}` };
}

async function defaultExtractAudio(): Promise<(filePath: string) => Promise<ToolResult>> {
  const { VideoTool } = await import('../video-tool.js');
  const tool = new VideoTool();
  return (filePath: string) => tool.extractAudio(filePath);
}

/**
 * Understand a video → a normalized, persisted, timestamped transcript. Phase 1:
 * no LLM, transcript-first, never-throws.
 */
export async function understandVideo(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps = {},
): Promise<UnderstandVideoResult> {
  const source = input.source?.trim();
  if (!source) return { error: 'source is required' };

  const cwd = deps.cwd ?? process.cwd();
  const outDir = deps.outDir ?? join(cwd, '.codebuddy', 'video');
  const maxChars = deps.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    return { error: `could not create output dir ${outDir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  const resolved = await resolveSegments({ ...input, source }, deps, outDir);
  if ('error' in resolved) return resolved;

  const { segments, method } = resolved;
  const transcriptPath = join(outDir, `transcript-${safeSlug(source)}.txt`);
  const rendered = renderTranscript(segments);

  const header = `# Transcript\nsource: ${source}\nmethod: ${method}\nsegments: ${segments.length}\n${input.question ? `question: ${input.question}\n` : ''}`;
  try {
    await writeFile(transcriptPath, `${header}\n${rendered}\n`, 'utf8');
  } catch (err) {
    logger.warn(`[video] could not persist transcript to ${transcriptPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let output: string;
  if (segments.length === 0) {
    output = `Aucune parole détectée dans la vidéo (méthode: ${method}). Transcript vide écrit dans ${transcriptPath}.`;
  } else if (rendered.length <= maxChars) {
    output = `Transcript horodaté (${segments.length} segments, méthode: ${method}) — sauvegardé dans ${transcriptPath}:\n\n${rendered}`;
  } else {
    output = `Transcript horodaté tronqué (${segments.length} segments, méthode: ${method}). Transcript complet dans ${transcriptPath}:\n\n${rendered.slice(0, maxChars)}\n\n… [tronqué — transcript complet dans ${transcriptPath}]`;
  }

  return { segments, transcriptPath, source, method, output };
}
