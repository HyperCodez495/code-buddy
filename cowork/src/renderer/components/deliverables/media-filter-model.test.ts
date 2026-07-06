/**
 * media-filter-model — kind filter + folded text search over prompt/model/name.
 */
import { describe, expect, it } from 'vitest';
import { filterMedia, type FilterableMedia } from './media-filter-model.js';

const items: FilterableMedia[] = [
  { path: '/m/img-cat.jpg', kind: 'image', prompt: 'Un chaton roux sur un clavier', model: 'grok-imagine-image' },
  { path: '/m/vid-dog.mp4', kind: 'video', prompt: 'A shar-pei puppy running', model: 'grok-imagine-video' },
  { path: '/m/voice.wav', kind: 'audio' },
];

describe('filterMedia', () => {
  it('filters by kind', () => {
    expect(filterMedia(items, 'image', '').map((i) => i.path)).toEqual(['/m/img-cat.jpg']);
    expect(filterMedia(items, 'all', '')).toHaveLength(3);
  });

  it('searches the prompt with diacritic folding', () => {
    expect(filterMedia(items, 'all', 'chaton').map((i) => i.path)).toEqual(['/m/img-cat.jpg']);
    // « clAVier » folded/lowercased still matches
    expect(filterMedia(items, 'all', 'CLAVIER')).toHaveLength(1);
  });

  it('searches model and file name too', () => {
    expect(filterMedia(items, 'all', 'video').map((i) => i.path)).toEqual(['/m/vid-dog.mp4']);
    expect(filterMedia(items, 'all', 'voice').map((i) => i.path)).toEqual(['/m/voice.wav']);
  });

  it('combines kind + query', () => {
    expect(filterMedia(items, 'video', 'puppy').map((i) => i.path)).toEqual(['/m/vid-dog.mp4']);
    expect(filterMedia(items, 'image', 'puppy')).toHaveLength(0);
  });
});
