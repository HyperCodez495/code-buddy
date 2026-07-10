import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextInjectionLevel } from '../../../src/agent/execution/query-classifier.js';

vi.mock('../../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: () => false,
}));
vi.mock('../../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: () => ({ buildContextBlock: () => null }),
}));
vi.mock('../../../src/agent/todo-tracker.js', () => ({
  getTodoTracker: () => ({ buildContextSuffix: () => null }),
}));

import { injectInitialContext } from '../../../src/agent/execution/context-pipeline.js';

const CONTEXT_LEVEL: ContextInjectionLevel = {
  workspace: true,
  lessons: false,
  knowledgeGraph: false,
  decisionMemory: true,
  icmMemory: true,
  codeGraph: true,
  docs: true,
  todo: false,
};

describe('initial context latency', () => {
  it('starts independent async providers concurrently and preserves block order', async () => {
    const started: string[] = [];
    const release = new Map<string, () => void>();

    const delayed = <T>(name: string, value: T): Promise<T> => {
      started.push(name);
      return new Promise<T>((resolve) => {
        release.set(name, () => resolve(value));
      });
    };

    const messages: CodeBuddyMessage[] = [];
    const injection = injectInitialContext(messages, {
      message: 'implement a responsive assistant',
      cwd: '/tmp/context-latency',
      ctxLevel: CONTEXT_LEVEL,
      loadWorkspaceContext: () => delayed('workspace', 'WORKSPACE'),
      decisionContextProvider: () => delayed('decision', 'DECISION'),
      icmBridgeProvider: () => ({
        isAvailable: () => true,
        searchMemory: () => delayed('memory', [{ content: 'MEMORY' }]),
      }),
      codeGraphContextProvider: () => 'CODE_GRAPH',
      docsContextProvider: () => 'DOCS',
    });

    // No provider has resolved, yet all three async lookups have started.
    expect(started).toEqual(['workspace', 'decision', 'memory']);
    expect(messages).toEqual([]);

    release.get('memory')?.();
    release.get('decision')?.();
    release.get('workspace')?.();
    await injection;

    expect(messages.map((entry) => entry.content)).toEqual([
      'WORKSPACE',
      '<context type="decision">\nDECISION\n</context>',
      '<context type="memory">\nRelevant cross-session memories:\n- MEMORY\n</context>',
      '<context type="code_graph">\nCODE_GRAPH\n</context>',
      '<context type="docs">\nDOCS\n</context>',
    ]);
  });
});
