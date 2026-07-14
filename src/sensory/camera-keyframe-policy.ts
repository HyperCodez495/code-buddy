import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function cameraSpoolRoot(): string {
  const configured = process.env.BUDDY_SENSE_FRAME_DIR?.trim();
  if (!configured) return join(homedir(), '.codebuddy', 'companion');
  return configured.startsWith('~/')
    ? join(homedir(), configured.slice(2))
    : resolve(configured);
}

/**
 * Resolve an untrusted sensor path inside the configured camera spool.
 * Returning the real path prevents traversal and symlink escapes before a VLM
 * or Telegram adapter reads the file.
 */
export async function safeCameraKeyframePath(
  candidate: unknown,
  options: { root?: string; maxBytes?: number } = {},
): Promise<string | undefined> {
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
  try {
    const root = await realpath(resolve(options.root ?? cameraSpoolRoot()));
    const file = await realpath(resolve(candidate));
    if (file !== root && !file.startsWith(`${root}${sep}`)) return undefined;
    if (!ALLOWED_EXTENSIONS.has(extname(file).toLowerCase())) return undefined;
    const metadata = await stat(file);
    const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) return undefined;
    return file;
  } catch {
    return undefined;
  }
}

/** Raw camera egress is a separate consent from semantic vision processing. */
export function telegramVisionPhotoPath(path: string | undefined): string | undefined {
  return process.env.CODEBUDDY_VISION_TELEGRAM_PHOTO === 'true' ? path : undefined;
}
