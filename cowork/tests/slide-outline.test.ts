import { describe, expect, it } from 'vitest';

import { draftOutline, outlineToSpeakerNotes } from '../src/renderer/utils/slide-outline';

describe('draftOutline', () => {
  it('creates a five-slide outline from a prompt', () => {
    const outline = draftOutline('Lancer un agent IA pour support client');

    expect(outline).toHaveLength(5);
    expect(outline[0]?.title).toBe('Lancer un agent IA pour support client');
    expect(outline.every((slide) => slide.bullets.length >= 3)).toBe(true);
  });

  it('falls back for an empty prompt', () => {
    expect(draftOutline('')[0]?.title).toBe('Deck sans titre');
  });
});

describe('outlineToSpeakerNotes', () => {
  it('serializes slides into speaker notes', () => {
    const notes = outlineToSpeakerNotes([
      { id: 'one', title: 'Intro', bullets: ['A', 'B'] },
      { id: 'two', title: 'Suite', bullets: ['C'] },
    ]);

    expect(notes).toContain('Slide 1: Intro');
    expect(notes).toContain('- C');
  });
});
