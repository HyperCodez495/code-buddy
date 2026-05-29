import type { Memory, MemoryConfig } from './persistent-memory.js';
import { getMemoryManager, PersistentMemoryManager } from './persistent-memory.js';
import type { MemoryProvider, MemoryRememberOptions } from './memory-provider.js';

/**
 * Default provider: the existing local SQLite/markdown memory manager.
 * Synchronous calls are wrapped in resolved promises to satisfy the async
 * boundary without changing the underlying store.
 */
export class LocalMemoryProvider implements MemoryProvider {
  readonly id = 'local';
  private manager: PersistentMemoryManager;
  private initialized = false;

  constructor(config?: Partial<MemoryConfig>) {
    this.manager = getMemoryManager(config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.manager.initialize();
    this.initialized = true;
  }

  async remember(key: string, value: string, options: MemoryRememberOptions = {}): Promise<void> {
    await this.manager.remember(key, value, options);
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    return this.manager.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    return this.manager.getRelevantMemories(query, limit);
  }

  async getContextForPrompt(): Promise<string> {
    return this.manager.getContextForPrompt();
  }
}
