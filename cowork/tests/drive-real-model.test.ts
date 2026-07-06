/**
 * drive-real-model — real tests: map recent workspace files into DriveGrid
 * items (type by extension, newest first, noise filtered).
 */
import { describe, expect, it } from 'vitest';
import { isDriveWorthy, toDriveItem, toDriveItems } from '../src/renderer/components/deliverables/drive-real-model';

describe('toDriveItems', () => {
  it('maps real deliverables by extension and sorts newest first', () => {
    const items = toDriveItems([
      { path: '/w/Nuit autopilote.pptx', modifiedAt: 100, size: 54000 },
      { path: '/w/commits-nuit-v2.xlsx', modifiedAt: 300, size: 5800 },
      { path: '/w/tts-proof.wav', modifiedAt: 200, size: 155000 },
      { path: '/w/.codebuddy/media-generation/images/img-1.jpg', modifiedAt: 400, size: 331000 },
      { path: '/w/notes.tmp', modifiedAt: 500, size: 10 }, // noise → dropped
    ]);
    expect(items.map((i) => i.type)).toEqual(['image', 'sheet', 'podcast', 'deck']);
    expect(items[0]!.tags).toContain('jpg');
    expect(items[0]!.tags).toContain('images');
    expect(items[3]!.title).toBe('Nuit autopilote.pptx');
  });

  it('isDriveWorthy filters workspace noise', () => {
    expect(isDriveWorthy('/w/app.mp4')).toBe(true);
    expect(isDriveWorthy('/w/node_modules/x.js')).toBe(false);
    expect(toDriveItem({ path: '/w/x.unknown', modifiedAt: 1, size: 1 })).toBeNull();
  });
});
