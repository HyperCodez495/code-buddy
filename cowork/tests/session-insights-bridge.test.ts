import { describe, expect, it } from 'vitest';
import { SessionInsightsBridge } from '../src/main/session/session-insights-bridge';
import type { Message, Session, TraceStep } from '../src/renderer/types';

const sessions: Session[] = [
  {
    id: 's1',
    title: 'Fix auth bug',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    model: 'claude-sonnet',
    cwd: '/repo/auth',
    createdAt: 1,
    updatedAt: 5,
  },
  {
    id: 's2',
    title: 'Write release notes',
    status: 'completed',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    model: 'gpt-5.4',
    cwd: '/repo/docs',
    createdAt: 2,
    updatedAt: 10,
  },
];

const messagesBySession: Record<string, Message[]> = {
  s1: [
    {
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'Please inspect the auth regression' }],
      tokenUsage: { input: 10, output: 0 },
    },
    {
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      timestamp: 2,
      content: [{ type: 'thinking', thinking: 'Checking auth flow' }],
      tokenUsage: { input: 0, output: 20 },
      executionTimeMs: 1200,
    },
  ],
  s2: [
    {
      id: 'm3',
      sessionId: 's2',
      role: 'user',
      timestamp: 3,
      content: [{ type: 'text', text: 'Draft the release notes for worktree support' }],
      tokenUsage: { input: 4, output: 0 },
    },
  ],
};

const traceStepsBySession: Record<string, TraceStep[]> = {
  s1: [
    {
      id: 't1',
      type: 'tool_call',
      status: 'completed',
      title: 'Read',
      toolName: 'Read',
      timestamp: 3,
    },
  ],
  s2: [],
};

describe('SessionInsightsBridge', () => {
  const bridge = new SessionInsightsBridge({
    listSessions: () => sessions,
    getMessages: (sessionId: string) => messagesBySession[sessionId] ?? [],
    getTraceSteps: (sessionId: string) => traceStepsBySession[sessionId] ?? [],
  });

  it('aggregates session metrics and sorts by most recently updated', () => {
    const result = bridge.list();
    expect(result.map((entry) => entry.sessionId)).toEqual(['s2', 's1']);
    expect(result[1]).toMatchObject({
      sessionId: 's1',
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 1,
      tokenInput: 10,
      tokenOutput: 20,
      totalTokens: 30,
      totalExecutionTimeMs: 1200,
    });
    expect(result[1]?.transcriptPreview).toContain('auth regression');
  });

  it('searches across title, model, cwd, and transcript preview', () => {
    expect(bridge.search('release')).toHaveLength(1);
    expect(bridge.search('claude-sonnet')[0]?.sessionId).toBe('s1');
    expect(bridge.search('/repo/docs')[0]?.sessionId).toBe('s2');
    expect(bridge.search('checking auth flow')[0]?.sessionId).toBe('s1');
  });

  it('searches full transcript text and returns a focused match snippet', () => {
    const bridgeWithLongTranscript = new SessionInsightsBridge({
      listSessions: () => sessions,
      getMessages: (sessionId: string) =>
        sessionId === 's1'
          ? [
              {
                id: 'm-long',
                sessionId: 's1',
                role: 'assistant',
                timestamp: 4,
                content: [
                  {
                    type: 'text',
                    text:
                      'Prelude '.repeat(40) +
                      'the hidden needle appears near the end of the transcript for search coverage',
                  },
                ],
              } as Message,
            ]
          : (messagesBySession[sessionId] ?? []),
      getTraceSteps: (sessionId: string) => traceStepsBySession[sessionId] ?? [],
    });

    const results = bridgeWithLongTranscript.search('hidden needle');
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe('s1');
    expect(results[0]?.matchSnippet).toContain('hidden needle');
    expect(results[0]?.matchRole).toBe('assistant');
    expect(results[0]?.matchCount).toBe(1);
    expect(results[0]?.matchMessageId).toBe('m-long');
  });

  it('returns detailed transcript data for a session', () => {
    const detail = bridge.getDetail('s1');
    expect(detail?.summary.sessionId).toBe('s1');
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.traceSteps).toHaveLength(1);
  });
});
