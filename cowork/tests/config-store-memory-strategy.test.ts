import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-memory-strategy.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore memoryStrategy', () => {
  it('persists the memory strategy through updates and direct reads', () => {
    const store = new ConfigStore();

    expect(store.get('memoryStrategy')).toBe('auto');

    store.update({ memoryStrategy: 'rolling' });

    expect(store.get('memoryStrategy')).toBe('rolling');
    expect(store.getAll().memoryStrategy).toBe('rolling');
  });
});
