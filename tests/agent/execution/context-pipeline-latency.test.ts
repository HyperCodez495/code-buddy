import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextInjectionLevel } from '../../../src/agent/execution/query-classifier.js';

const {
  buildOperationalSelfModelMock,
  lessonsContextMock,
  todoContextMock,
  knowledgeGraphLoadMock,
  knowledgeGraphFormatMock,
} = vi.hoisted(() => ({
  buildOperationalSelfModelMock: vi.fn((options: { runtime?: unknown }) => ({
    text:
      'Conscience subjective : non établie. ' +
      `runtime=${JSON.stringify(options.runtime ?? null)}`,
  })),
  lessonsContextMock: vi.fn(() => null),
  todoContextMock: vi.fn(() => null),
  knowledgeGraphLoadMock: vi.fn(async () => undefined),
  knowledgeGraphFormatMock: vi.fn(() => 'KNOWLEDGE_GRAPH'),
}));

vi.mock('../../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: () => false,
}));
vi.mock('../../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: () => ({ buildContextBlock: lessonsContextMock }),
}));
vi.mock('../../../src/agent/todo-tracker.js', () => ({
  getTodoTracker: () => ({ buildContextSuffix: todoContextMock }),
}));
vi.mock('../../../src/memory/knowledge-graph.js', () => ({
  getKnowledgeGraph: () => ({
    load: knowledgeGraphLoadMock,
    formatContextBlockSmart: knowledgeGraphFormatMock,
  }),
}));
vi.mock('../../../src/identity/operational-self-model.js', () => ({
  buildOperationalSelfModel: buildOperationalSelfModelMock,
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

  it('grounds chat-only introspection with explicit turn provenance', async () => {
    const messages: CodeBuddyMessage[] = [];
    await injectInitialContext(messages, {
      message: 'Lisa, étudie ton propre code et explique comment tu fonctionnes',
      cwd: '/tmp/context-introspection',
      ctxLevel: {
        workspace: false,
        lessons: false,
        knowledgeGraph: false,
        decisionMemory: false,
        icmMemory: false,
        codeGraph: false,
        docs: false,
        todo: false,
      },
      loadWorkspaceContext: async () => '',
      decisionContextProvider: null,
      icmBridgeProvider: null,
      codeGraphContextProvider: null,
      operationalRuntime: {
        model: 'chat-only-model',
        provider: 'test-provider',
        surface: 'cowork',
        permissionMode: 'plan',
      },
    });

    expect(buildOperationalSelfModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: {
          model: 'chat-only-model',
          provider: 'test-provider',
          surface: 'cowork',
          permissionMode: 'plan',
        },
      })
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('"surface":"cowork"');
    expect(messages[0]?.content).toContain('Conscience');
  });

  it('isolates read-only introspection from every unrelated project context provider', async () => {
    const loadWorkspaceContext = vi.fn(async () => 'WORKSPACE_SECRET');
    const decisionContextProvider = vi.fn(async () => 'DECISION_SECRET');
    const icmSearch = vi.fn(async () => [{ content: 'ICM_SECRET' }]);
    const icmBridgeProvider = vi.fn(() => ({
      isAvailable: () => true,
      searchMemory: icmSearch,
    }));
    const codeGraphContextProvider = vi.fn(() => 'CODE_GRAPH_SECRET');
    const docsContextProvider = vi.fn(() => 'DOCS_SECRET');
    lessonsContextMock.mockClear();
    todoContextMock.mockClear();
    knowledgeGraphLoadMock.mockClear();
    knowledgeGraphFormatMock.mockClear();

    const messages: CodeBuddyMessage[] = [];
    await injectInitialContext(messages, {
      message: 'Inspecte ton propre code et explique comment tu fonctionnes',
      cwd: '/tmp/unrelated-cowork-project',
      ctxLevel: {
        workspace: true,
        lessons: true,
        knowledgeGraph: true,
        collectiveGraph: true,
        decisionMemory: true,
        icmMemory: true,
        codeGraph: true,
        docs: true,
        todo: true,
      },
      loadWorkspaceContext,
      decisionContextProvider,
      icmBridgeProvider,
      codeGraphContextProvider,
      docsContextProvider,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('operational_self_model');
    expect(loadWorkspaceContext).not.toHaveBeenCalled();
    expect(decisionContextProvider).not.toHaveBeenCalled();
    expect(icmBridgeProvider).not.toHaveBeenCalled();
    expect(icmSearch).not.toHaveBeenCalled();
    expect(codeGraphContextProvider).not.toHaveBeenCalled();
    expect(docsContextProvider).not.toHaveBeenCalled();
    expect(lessonsContextMock).not.toHaveBeenCalled();
    expect(todoContextMock).not.toHaveBeenCalled();
    expect(knowledgeGraphLoadMock).not.toHaveBeenCalled();
    expect(knowledgeGraphFormatMock).not.toHaveBeenCalled();
  });

  it('classifies the explicit utterance instead of an introspective voice preamble', async () => {
    const ctxLevel: ContextInjectionLevel = {
      workspace: false,
      lessons: false,
      knowledgeGraph: false,
      decisionMemory: false,
      icmMemory: false,
      codeGraph: false,
      docs: false,
      todo: false,
    };
    const actionMessages: CodeBuddyMessage[] = [];
    await injectInitialContext(actionMessages, {
      message:
        'Contexte récent : Patrice: es-tu consciente ?\n\n' +
        'Demande actuelle : crée un fichier',
      introspectionText: 'crée un fichier',
      cwd: '/tmp/context-current-utterance',
      ctxLevel,
      loadWorkspaceContext: async () => '',
      decisionContextProvider: null,
      icmBridgeProvider: null,
      codeGraphContextProvider: null,
    });
    expect(actionMessages).toEqual([]);

    const introspectionMessages: CodeBuddyMessage[] = [];
    await injectInitialContext(introspectionMessages, {
      message:
        'Contexte récent : Patrice: crée un fichier\n\n' +
        'Demande actuelle : étudie ton propre code',
      introspectionText: 'étudie ton propre code',
      cwd: '/tmp/context-current-utterance',
      ctxLevel,
      loadWorkspaceContext: async () => '',
      decisionContextProvider: null,
      icmBridgeProvider: null,
      codeGraphContextProvider: null,
    });
    expect(introspectionMessages).toHaveLength(1);
    expect(buildOperationalSelfModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ focus: 'étudie ton propre code' })
    );
  });
});
