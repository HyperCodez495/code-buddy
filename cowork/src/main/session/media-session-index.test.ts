/**
 * media-session-index — link a media basename to the conversation that
 * generated it (the basename is echoed in that session's assistant text).
 */
import { describe, expect, it } from 'vitest';
import { basenameOf, buildMediaSessionIndex } from './media-session-index.js';

describe('buildMediaSessionIndex', () => {
  it('maps each media basename to the session whose text mentions it', () => {
    const index = buildMediaSessionIndex([
      { sessionId: 's1', text: 'Vidéo créée : MEDIA:/home/pat/.codebuddy/media-generation/videos/video-123-abc.mp4' },
      { sessionId: 's2', text: 'Voici image-456-def.jpg dans le refuge' },
      { sessionId: 's3', text: 'aucun média ici' },
    ]);
    expect(index.get('video-123-abc.mp4')).toBe('s1');
    expect(index.get('image-456-def.jpg')).toBe('s2');
    expect(index.size).toBe(2);
  });

  it('keeps the FIRST session that mentions a basename', () => {
    const index = buildMediaSessionIndex([
      { sessionId: 'first', text: 'clip-1.mp4' },
      { sessionId: 'second', text: 'clip-1.mp4 again' },
    ]);
    expect(index.get('clip-1.mp4')).toBe('first');
  });

  it('ignores non-media tokens', () => {
    const index = buildMediaSessionIndex([{ sessionId: 's', text: 'index.html style.css app.js README.md' }]);
    expect(index.size).toBe(0);
  });
});

describe('basenameOf', () => {
  it('extracts the file name from a path', () => {
    expect(basenameOf('/home/pat/.codebuddy/media-generation/images/a.jpg')).toBe('a.jpg');
    expect(basenameOf('a.jpg')).toBe('a.jpg');
  });
});
