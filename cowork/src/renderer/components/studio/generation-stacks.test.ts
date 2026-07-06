import { describe, expect, it } from 'vitest';
import { findStack, GENERATION_STACKS } from './generation-stacks';

describe('generation-stacks', () => {
  it('exposes exactly five stacks with unique ids', () => {
    expect(GENERATION_STACKS).toHaveLength(5);

    const ids = GENERATION_STACKS.map((stack) => stack.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['static', 'react-vite', 'vue-vite', 'pwa', 'expo']);
  });

  it('fills every public field', () => {
    for (const stack of GENERATION_STACKS) {
      expect(stack.id).toBeTruthy();
      expect(stack.label).toBeTruthy();
      expect(stack.description).toBeTruthy();
      expect(stack.planStack).toBeTruthy();
      expect(stack.guidance).toBeTruthy();
      expect(stack.previewNote).toBeTruthy();
      expect(typeof stack.runnable).toBe('boolean');
    }
  });

  it('marks only Expo as not runnable inside Cowork', () => {
    expect(GENERATION_STACKS.filter((stack) => !stack.runnable).map((stack) => stack.id)).toEqual(['expo']);
    expect(GENERATION_STACKS.filter((stack) => stack.runnable).map((stack) => stack.id)).toEqual([
      'static',
      'react-vite',
      'vue-vite',
      'pwa',
    ]);
  });

  it('falls back to static when the id is missing or unknown', () => {
    expect(findStack(undefined)?.id).toBe('static');
    expect(findStack('inconnu')?.id).toBe('static');
  });

  it('finds a known stack by id', () => {
    expect(findStack('react-vite')?.id).toBe('react-vite');
  });
});
