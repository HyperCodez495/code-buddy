/**
 * Video understanding — Collective Knowledge Graph (CKG) ingestion bridge tests.
 *
 * The single side-effecting edge — the CKG — is an INJECTED fake `VideoCkgBridge`, so
 * every test runs with ZERO ledger / ZERO network. Covers:
 *  - `buildVideoIngestText`: bounded provenance header + summary + spread-out key
 *    facts, never the full transcript, clean truncation
 *  - `ingestVideoUnderstanding`: stores ONE discovery node with bounded text +
 *    provenance; skips silently when there's nothing to say; never-throws on a
 *    bridge failure; idempotent (identical input ⇒ identical payload across calls)
 */
import { describe, it, expect, vi } from 'vitest';

import {
  buildVideoIngestText,
  ingestVideoUnderstanding,
  type VideoCkgBridge,
  type VideoCkgIngestPayload,
  type VideoCkgSourceInfo,
} from '../../../src/tools/video/video-ckg.js';

function fakeBridge(impl?: (payload: VideoCkgIngestPayload) => Promise<unknown>): VideoCkgBridge {
  return { ingest: vi.fn(impl ?? (async () => ({ id: 'discovery:collective:x' }))) };
}

function seg(said: string): { said: string } {
  return { said };
}

// ==========================================================================
// buildVideoIngestText — pure, bounded
// ==========================================================================

describe('buildVideoIngestText', () => {
  const base: VideoCkgSourceInfo = {
    source: 'https://youtu.be/dQw4w9WgXcQ',
    method: 'youtube-captions',
    segments: [seg('intro segment'), seg('middle segment'), seg('conclusion segment')],
  };

  it('includes a provenance header (method + source)', () => {
    const text = buildVideoIngestText(base);
    expect(text).toContain('youtube-captions');
    expect(text).toContain('https://youtu.be/dQw4w9WgXcQ');
  });

  it('prefers the richer answer as the primary summary', () => {
    const text = buildVideoIngestText({ ...base, answer: 'This video explains RRF rank fusion.' });
    expect(text).toContain('This video explains RRF rank fusion.');
  });

  it('falls back to the asked question when there is no richer answer', () => {
    const text = buildVideoIngestText({ ...base, question: 'What is this about?' });
    expect(text).toContain('What is this about?');
  });

  it('folds in a handful of key transcript excerpts', () => {
    const text = buildVideoIngestText(base);
    expect(text).toContain('Extraits clés');
    expect(text).toContain('intro segment');
    expect(text).toContain('conclusion segment');
  });

  it('is bounded: a very long transcript never produces the full transcript', () => {
    const longSegment = 'word '.repeat(500); // ~2500 chars each
    const manySegments = Array.from({ length: 30 }, (_, i) => seg(`${longSegment}${i}`));
    const fullLength = manySegments.reduce((n, s) => n + s.said.length, 0);
    const text = buildVideoIngestText({ ...base, segments: manySegments });
    expect(text.length).toBeLessThanOrEqual(4000); // hard cap
    expect(text.length).toBeLessThan(fullLength / 10); // WAY shorter than the transcript
  });

  it('clamps maxChars into [200, 4000] and truncates cleanly (no mid-word cut when avoidable)', () => {
    const longAnswer = 'alpha beta gamma delta epsilon zeta eta theta iota kappa '.repeat(50);
    const text = buildVideoIngestText({ ...base, answer: longAnswer }, { maxChars: 100 });
    expect(text.length).toBeLessThanOrEqual(200); // clamped up to the MIN_CHARS floor
    const short = buildVideoIngestText({ ...base, answer: longAnswer }, { maxChars: 300 });
    expect(short.length).toBeLessThanOrEqual(300);
    expect(short.endsWith('…')).toBe(true);
  });

  it('an empty transcript with no answer/question yields just the header', () => {
    const text = buildVideoIngestText({ ...base, segments: [] });
    expect(text).toBe(`Vidéo (youtube-captions) — https://youtu.be/dQw4w9WgXcQ`);
  });
});

// ==========================================================================
// ingestVideoUnderstanding — bounded, idempotent, never-throws
// ==========================================================================

describe('ingestVideoUnderstanding', () => {
  const info: VideoCkgSourceInfo = {
    source: 'https://youtu.be/dQw4w9WgXcQ',
    method: 'youtube-captions',
    segments: [seg('intro'), seg('body'), seg('conclusion')],
    answer: 'A concise summary of the video.',
  };

  it('stores ONE discovery node with bounded text + provenance (name = source, source tag)', async () => {
    const calls: VideoCkgIngestPayload[] = [];
    const bridge = fakeBridge(async (p) => {
      calls.push(p);
      return { id: 'discovery:collective:x' };
    });
    const stored = await ingestVideoUnderstanding(info, bridge);
    expect(stored).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(calls[0]!.source).toBe('video-understanding');
    expect(calls[0]!.text).toContain('A concise summary of the video.');
    expect(calls[0]!.text.length).toBeLessThanOrEqual(4000);
  });

  it('skips silently (bridge never called) when there is nothing meaningful to store', async () => {
    const bridge = fakeBridge();
    const stored = await ingestVideoUnderstanding(
      { source: 'https://youtu.be/empty', method: 'youtube-captions', segments: [] },
      bridge,
    );
    expect(stored).toBe(false);
    expect(bridge.ingest).not.toHaveBeenCalled();
  });

  it('skips silently when the source is empty', async () => {
    const bridge = fakeBridge();
    const stored = await ingestVideoUnderstanding({ ...info, source: '   ' }, bridge);
    expect(stored).toBe(false);
    expect(bridge.ingest).not.toHaveBeenCalled();
  });

  it('never throws — a bridge rejection degrades to false', async () => {
    const bridge = fakeBridge(async () => {
      throw new Error('ledger unwritable');
    });
    await expect(ingestVideoUnderstanding(info, bridge)).resolves.toBe(false);
  });

  it('a falsy bridge result (null) is reported as not-stored, but still never throws', async () => {
    const bridge = fakeBridge(async () => null);
    await expect(ingestVideoUnderstanding(info, bridge)).resolves.toBe(false);
  });

  it('idempotent: two calls with identical input produce an identical payload (the CKG dedups on name+text)', async () => {
    const calls: VideoCkgIngestPayload[] = [];
    const bridge = fakeBridge(async (p) => {
      calls.push(p);
      return { id: 'x' };
    });
    await ingestVideoUnderstanding(info, bridge);
    await ingestVideoUnderstanding(info, bridge);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it('a transcript-only video (no answer/question) still ingests a bounded digest of key excerpts', async () => {
    const calls: VideoCkgIngestPayload[] = [];
    const bridge = fakeBridge(async (p) => {
      calls.push(p);
      return { id: 'x' };
    });
    const stored = await ingestVideoUnderstanding(
      { source: 'https://youtu.be/x', method: 'youtube-audio', segments: [seg('only the transcript speaks here')] },
      bridge,
    );
    expect(stored).toBe(true);
    expect(calls[0]!.text).toContain('only the transcript speaks here');
  });
});
