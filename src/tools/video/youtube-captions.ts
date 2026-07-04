/**
 * YouTube caption fetch — the FREE, local-first first leg of the video-understanding
 * cascade. Pulls the creator/auto captions straight from YouTube's (unofficial)
 * timedtext endpoints via a tiny node lib, so a captioned video is understood with
 * zero transcription cost.
 *
 * Reality check: these endpoints are unofficial and IP-sensitive — reliable from a
 * residential IP, routinely blocked in a datacenter. So this NEVER throws: any
 * failure (no video id, no captions, network block, malformed payload) returns
 * `null`, and the orchestrator falls back to yt-dlp + local Whisper.
 *
 * @module tools/video/youtube-captions
 */

import { logger } from '../../utils/logger.js';

/** A raw caption cue, normalized to numbers. */
export interface Segment {
  text: string;
  /** Cue start in seconds. */
  start: number;
  /** Cue duration in seconds. */
  duration: number;
}

/** Shape of a cue as returned by `youtube-caption-extractor` (string fields). */
export interface RawSubtitle {
  start: string;
  dur: string;
  text: string;
}

/** Injectable caption fetcher (the lib's `getSubtitles`) — lets tests avoid the network. */
export type GetSubtitlesFn = (opts: { videoID: string; lang?: string }) => Promise<RawSubtitle[]>;

export interface YoutubeCaptionDeps {
  /** Override the caption fetcher. Default: lazy-loaded `youtube-caption-extractor`. */
  getSubtitles?: GetSubtitlesFn;
}

/**
 * Extract the 11-char YouTube video id from the common URL shapes:
 * `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/embed/<id>`,
 * `youtube.com/shorts/<id>`, or a bare id. Returns `null` when nothing matches.
 */
export function extractYoutubeVideoId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Bare 11-char id.
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/, // watch?v=ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/, // youtu.be/ID
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/, // /embed/ID
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/, // /shorts/ID
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/, // /v/ID
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** True when the URL points at YouTube (used by the orchestrator to pick the caption leg). */
export function isYoutubeUrl(url: string): boolean {
  return extractYoutubeVideoId(url) !== null && /(?:youtube\.com|youtu\.be)/i.test(url);
}

function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Fetch YouTube captions for `url`, trying each language in `langs` (default
 * `['en', 'fr']`) until one yields cues. Returns normalized `Segment[]`, or `null`
 * when no captions are available / the endpoint is blocked / anything throws.
 * Never throws.
 */
export async function fetchYoutubeCaptions(
  url: string,
  langs: string[] = ['en', 'fr'],
  deps: YoutubeCaptionDeps = {},
): Promise<Segment[] | null> {
  const videoID = extractYoutubeVideoId(url);
  if (!videoID) {
    logger.debug(`[video] no YouTube video id in "${url}"`);
    return null;
  }

  let getSubtitles = deps.getSubtitles;
  if (!getSubtitles) {
    try {
      ({ getSubtitles } = await import('youtube-caption-extractor'));
    } catch (err) {
      logger.warn(`[video] youtube-caption-extractor unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // Try each requested language, then a lang-less call (default track), stopping at
  // the first non-empty result.
  const attempts = [...langs, undefined];
  for (const lang of attempts) {
    try {
      const raw = await getSubtitles(lang ? { videoID, lang } : { videoID });
      if (Array.isArray(raw) && raw.length > 0) {
        const segments = raw
          .filter((cue): cue is RawSubtitle => !!cue && typeof cue.text === 'string')
          .map((cue) => ({
            text: cue.text.replace(/\s+/g, ' ').trim(),
            start: toNumber(cue.start),
            duration: toNumber(cue.dur),
          }))
          .filter((cue) => cue.text.length > 0);
        if (segments.length > 0) {
          logger.info(`[video] fetched ${segments.length} caption cues for ${videoID}${lang ? ` (${lang})` : ''}`);
          return segments;
        }
      }
    } catch (err) {
      logger.debug(`[video] caption fetch failed (${videoID}${lang ? `, ${lang}` : ''}): ${err instanceof Error ? err.message : String(err)}`);
      // Try the next language / the default track.
    }
  }

  logger.info(`[video] no captions found for ${videoID}`);
  return null;
}
