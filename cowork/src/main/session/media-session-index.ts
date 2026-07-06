/**
 * media-session-index — link a generated media file back to the conversation
 * that produced it. Ground truth: the media path (its basename is enough —
 * basenames carry a timestamp + uuid, so they're unique) appears in the
 * assistant message that generated it (the `MEDIA:` marker / the path echoed
 * in the reply). Pure: given a set of (sessionId, text-blob) pairs and a media
 * basename, return the matching sessionId.
 */

export interface SessionTextBlob {
  sessionId: string;
  /** All message text of the session, concatenated (order irrelevant). */
  text: string;
}

/**
 * Build a basename → sessionId index. A basename maps to the FIRST session
 * whose text mentions it (generation happens once, in one session).
 */
export function buildMediaSessionIndex(blobs: ReadonlyArray<SessionTextBlob>): Map<string, string> {
  const index = new Map<string, string>();
  // A single regex pass per blob is far cheaper than substring-scanning every
  // known basename against every blob.
  const basenameRe = /[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mov|wav|mp3|ogg|flac)\b/gi;
  for (const blob of blobs) {
    for (const match of blob.text.matchAll(basenameRe)) {
      const name = match[0];
      if (!index.has(name)) index.set(name, blob.sessionId);
    }
  }
  return index;
}

/** basename for a path (forward or back slashes). */
export function basenameOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}
