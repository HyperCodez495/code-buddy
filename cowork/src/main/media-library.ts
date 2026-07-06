/**
 * media-library — index of every media file the agent generated, across all
 * session working directories (ChatGPT-library parity: one place to browse,
 * reuse and export generated images/videos/audio).
 *
 * Generated media lands under `<cwd>/.codebuddy/media-generation/{images,videos}`
 * for whichever cwd the generating session used, plus loose audio files at the
 * cwd root (TTS outputs). This module scans the distinct roots the session
 * manager knows about; pure helpers are exported for tests.
 */
import * as fs from 'fs';
import * as path from 'path';

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaItem {
  path: string;
  kind: MediaKind;
  size: number;
  mtimeMs: number;
  /** The session working directory this media belongs to. */
  root: string;
  /** Original generation prompt (from the `<file>.meta.json` sidecar). */
  prompt?: string;
  /** Generation model (sidecar). */
  model?: string;
  /** Generation provider (sidecar). */
  provider?: string;
  /** The conversation that generated this media (linked in media.list). */
  sessionId?: string;
}

const EXT_TO_KIND: Record<string, MediaKind> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.wav': 'audio',
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
};

/** Read the generation sidecar (`<file>.meta.json`) if present — fail-open. */
function readSidecar(filePath: string): { prompt?: string; model?: string; provider?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(`${filePath}.meta.json`, 'utf-8')) as Record<string, unknown>;
    return {
      ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt } : {}),
      ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
      ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
    };
  } catch {
    return {};
  }
}

export function kindOf(filePath: string): MediaKind | null {
  return EXT_TO_KIND[path.extname(filePath).toLowerCase()] ?? null;
}

function scanDirRecursive(dir: string, root: string, out: MediaItem[], depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirRecursive(full, root, out, depth + 1);
    } else if (entry.isFile()) {
      const kind = kindOf(entry.name);
      if (!kind) continue;
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, kind, size: stat.size, mtimeMs: stat.mtimeMs, root, ...readSidecar(full) });
      } catch {
        /* raced deletion — skip */
      }
    }
  }
}

/**
 * Scan one session root: `.codebuddy/media-generation/**` (recursive) plus
 * loose media files at the root itself (TTS wav outputs — non-recursive so a
 * source tree is never crawled).
 */
export function scanRoot(root: string): MediaItem[] {
  const out: MediaItem[] = [];
  scanDirRecursive(path.join(root, '.codebuddy', 'media-generation'), root, out);
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const kind = kindOf(entry.name);
      if (!kind) continue;
      const full = path.join(root, entry.name);
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, kind, size: stat.size, mtimeMs: stat.mtimeMs, root, ...readSidecar(full) });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* root gone — fine */
  }
  return out;
}

/** Scan distinct roots, newest first, deduplicated by path, capped. */
export function scanMediaLibrary(roots: string[], cap = 500): MediaItem[] {
  const seen = new Set<string>();
  const all: MediaItem[] = [];
  for (const root of [...new Set(roots)].filter(Boolean)) {
    for (const item of scanRoot(root)) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      all.push(item);
    }
  }
  return all.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, cap);
}
