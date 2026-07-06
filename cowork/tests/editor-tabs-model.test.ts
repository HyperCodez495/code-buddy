/**
 * editor-tabs-model — real test (no mocks): open/close/dirty + active-after-close.
 */
import { describe, expect, it } from 'vitest';
import {
  basename,
  openTab,
  closeTab,
  nextActiveAfterClose,
  markDirty,
} from '../src/renderer/components/studio/editor-tabs-model';

describe('editor-tabs-model', () => {
  it('basename strips directories', () => {
    expect(basename('src/components/App.tsx')).toBe('App.tsx');
    expect(basename('index.html')).toBe('index.html');
  });

  it('openTab focuses without duplicating', () => {
    const a = openTab([], 'a.ts');
    expect(a).toEqual([{ path: 'a.ts' }]);
    expect(openTab(a, 'a.ts')).toEqual(a); // no dup
    expect(openTab(a, 'b.ts')).toHaveLength(2);
    expect(openTab(a, '')).toEqual(a); // ignores empty
  });

  it('closeTab removes a tab immutably', () => {
    const tabs = [{ path: 'a.ts' }, { path: 'b.ts' }];
    expect(closeTab(tabs, 'a.ts')).toEqual([{ path: 'b.ts' }]);
    expect(tabs).toHaveLength(2); // input untouched
  });

  it('nextActiveAfterClose picks the right neighbour', () => {
    const tabs = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
    expect(nextActiveAfterClose(tabs, 'b', 'b')).toBe('c'); // right neighbour
    expect(nextActiveAfterClose(tabs, 'c', 'c')).toBe('b'); // last → left
    expect(nextActiveAfterClose(tabs, 'a', 'b')).toBe('b'); // closing a non-active tab keeps active
    expect(nextActiveAfterClose([{ path: 'a' }], 'a', 'a')).toBeNull(); // last one
  });

  it('markDirty flags only the matching tab', () => {
    const tabs = [{ path: 'a' }, { path: 'b' }];
    const marked = markDirty(tabs, 'a', true);
    expect(marked.find((t) => t.path === 'a')!.dirty).toBe(true);
    expect(marked.find((t) => t.path === 'b')!.dirty).toBeUndefined();
  });
});
