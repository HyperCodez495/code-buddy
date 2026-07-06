/**
 * media-selection-model — pure multi-selection helpers for the media library.
 */
import { describe, expect, it } from 'vitest';
import { clear, isAllSelected, selectAll, selectionSummary, toggle } from './media-selection-model.js';

describe('media-selection-model', () => {
  it('toggles an id on without mutating the original set', () => {
    const selected = new Set(['a']);
    const next = toggle(selected, 'b');

    expect(next).toEqual(new Set(['a', 'b']));
    expect(selected).toEqual(new Set(['a']));
    expect(next).not.toBe(selected);
  });

  it('toggles an id off without mutating the original set', () => {
    const selected = new Set(['a', 'b']);
    const next = toggle(selected, 'a');

    expect(next).toEqual(new Set(['b']));
    expect(selected).toEqual(new Set(['a', 'b']));
    expect(next).not.toBe(selected);
  });

  it('selects all ids', () => {
    expect(selectAll(['a', 'b', 'c'])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('clears the selection', () => {
    expect(clear()).toEqual(new Set());
  });

  it('detects when all visible ids are selected', () => {
    expect(isAllSelected(new Set(['a', 'b', 'c']), ['a', 'b'])).toBe(true);
  });

  it('detects when not all visible ids are selected', () => {
    expect(isAllSelected(new Set(['a']), ['a', 'b'])).toBe(false);
  });

  it('returns false when there are no visible ids', () => {
    expect(isAllSelected(new Set(['a']), [])).toBe(false);
  });

  it('summarizes zero selections in French', () => {
    expect(selectionSummary(new Set(), 11)).toBe('0 / 11 sélectionnés');
  });

  it('summarizes one selection in French singular form', () => {
    expect(selectionSummary(new Set(['a']), 11)).toBe('1 / 11 sélectionné');
  });

  it('summarizes multiple selections in French plural form', () => {
    expect(selectionSummary(new Set(['a', 'b', 'c']), 11)).toBe('3 / 11 sélectionnés');
  });
});
