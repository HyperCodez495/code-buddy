import { describe, expect, it } from 'vitest';
import { SessionInsightsBridge } from '../src/main/session/session-insights-bridge';
import type { TurnJournalReadResult } from '../src/main/session/turn-journal';
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

const journalBySession: Record<string, TurnJournalReadResult> = {
  s1: {
    sessionId: 's1',
    path: '/tmp/s1.jsonl',
    exists: true,
    totalEventCount: 2,
    malformedLineCount: 0,
    pendingTurnCount: 1,
    events: [
      {
        schemaVersion: 1,
        type: 'turn_started',
        sessionId: 's1',
        ts: 11,
        turnId: 'turn-1',
      },
      {
        schemaVersion: 1,
        type: 'message_saved',
        sessionId: 's1',
        ts: 12,
        turnId: 'turn-1',
      },
    ],
    turns: [
      {
        turnId: 'turn-1',
        startedAt: 11,
        updatedAt: 12,
        latestType: 'message_saved',
        status: 'running',
        eventCount: 2,
        messageCount: 1,
        traceStepCount: 0,
      },
    ],
    replay: {
      sessionId: 's1',
      path: '/tmp/s1.jsonl',
      exists: true,
      totalEventCount: 2,
      malformedLineCount: 0,
      pendingTurnCount: 1,
      runCount: 1,
      runs: [
        {
          runId: 'turn-1',
          turnId: 'turn-1',
          startedAt: 11,
          updatedAt: 12,
          latestType: 'message_saved',
          status: 'running',
          eventCount: 2,
          anchorCount: 2,
          terminalEvent: {
            schemaVersion: 1,
            type: 'message_saved',
            sessionId: 's1',
            ts: 12,
            turnId: 'turn-1',
          },
          anchors: [
            {
              eventId: 's1:turn-1:0:turn_started',
              runId: 'turn-1',
              seq: 0,
              type: 'turn_started',
              ts: 11,
              turnId: 'turn-1',
            },
            {
              eventId: 's1:turn-1:0:message_saved',
              runId: 'turn-1',
              seq: 0,
              type: 'message_saved',
              ts: 12,
              turnId: 'turn-1',
            },
          ],
          events: [
            {
              schemaVersion: 1,
              type: 'turn_started',
              sessionId: 's1',
              ts: 11,
              turnId: 'turn-1',
            },
            {
              schemaVersion: 1,
              type: 'message_saved',
              sessionId: 's1',
              ts: 12,
              turnId: 'turn-1',
            },
          ],
        },
      ],
    },
  },
};

const memoryPreviewBySession = {
  s1: {
    sessionId: 's1',
    projectId: 'p1',
    memoryStrategy: 'auto' as const,
    automatedMemoryEnabled: true,
    projectMemoryAvailable: true,
    projectMemoryPath: '/repo/auth/.codebuddy/memory',
    projectContextAvailable: true,
    icmAvailable: true,
    recallEnabled: true,
    candidateCount: 1,
    candidates: [
      {
        category: 'decision' as const,
        content: 'Use the embedded engine for recovery flows.',
        sourceSessionId: 's1',
        sourceKind: 'assistant' as const,
        evidence: 'We will use the embedded engine for recovery flows.',
      },
    ],
  },
};

describe('SessionInsightsBridge', () => {
  const bridge = new SessionInsightsBridge({
    listSessions: () => sessions,
    getMessages: (sessionId: string) => messagesBySession[sessionId] ?? [],
    getTraceSteps: (sessionId: string) => traceStepsBySession[sessionId] ?? [],
    getTurnJournal: (sessionId: string) => journalBySession[sessionId],
    getMemoryPreview: (sessionId: string) => memoryPreviewBySession[sessionId] ?? null,
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

  it('builds bounded recall prefill from relevant previous sessions', () => {
    const recall = bridge.getRecallPrefill('auth regression', {
      currentSessionId: 's2',
      maxChars: 1_200,
    });

    expect(recall.entries[0]?.sessionId).toBe('s1');
    expect(recall.text).toContain('<session_recall_context>');
    expect(recall.text).toContain('Fix auth bug');
    expect(recall.entries[0]?.messageIds).toContain('m1');
  });

  it('excludes the active session from recall prefill', () => {
    const recall = bridge.getRecallPrefill('auth regression', {
      currentSessionId: 's1',
    });

    expect(recall.entries).toEqual([]);
    expect(recall.text).toBe('');
  });

  it('returns detailed transcript data for a session', () => {
    const detail = bridge.getDetail('s1');
    expect(detail?.summary.sessionId).toBe('s1');
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.traceSteps).toHaveLength(1);
    expect(detail?.turnJournal?.totalEventCount).toBe(2);
    expect(detail?.turnJournal?.turns[0]?.turnId).toBe('turn-1');
    expect(detail?.turnJournal?.replay.runCount).toBe(1);
    expect(detail?.turnJournal?.replay.runs[0]?.anchors).toHaveLength(2);
    expect(detail?.turnJournal?.replay.runs[0]?.events).toHaveLength(2);
    expect(detail?.memoryPreview?.candidateCount).toBe(1);
    expect(detail?.memoryPreview?.candidates[0]?.category).toBe('decision');
  });

  it('includes turn journal findings in session audit', () => {
    const audit = bridge.getAudit('s1');
    expect(audit?.pendingJournalTurns).toBe(1);
    expect(audit?.issues.some((issue) => issue.kind === 'turn_journal_pending_turn')).toBe(true);
  });

  it('repairs journal pending turns with interruption markers', () => {
    const result = bridge.repair('s1');
    expect(result?.changed).toBe(true);
    expect(result?.injectedJournalInterruptionMarkers).toBe(1);
    expect(result?.audit.pendingJournalTurns).toBe(0);
    expect(result?.messages.some((message) => message.metadata?.recovery?.turnId === 'turn-1')).toBe(
      true
    );
  });
});
