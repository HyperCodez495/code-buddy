import { describe, expect, it } from 'vitest';
import {
  auditSessionTranscript,
  repairSessionTranscript,
} from '../src/main/session/session-insights-bridge';

describe('session transcript audit', () => {
  it('detects orphan tool results, missing tool results, and empty messages', () => {
    const audit = auditSessionTranscript('s1', [
      {
        id: 'm-empty',
        sessionId: 's1',
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
      },
      {
        id: 'm-tool-use',
        sessionId: 's1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { path: 'src/index.ts' },
          },
        ],
        timestamp: Date.now(),
      },
      {
        id: 'm-orphan-result',
        sessionId: 's1',
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'missing-tool',
            content: 'not found',
          },
        ],
        timestamp: Date.now(),
      },
    ]);

    expect(audit.issueCount).toBe(3);
    expect(audit.emptyMessages).toBe(1);
    expect(audit.missingToolResults).toBe(1);
    expect(audit.orphanToolResults).toBe(1);
    expect(audit.pendingJournalTurns).toBe(0);
    expect(audit.missingJournalUserMessages).toBe(0);
    expect(audit.unrecoverableJournalSubmissions).toBe(0);
    expect(audit.malformedJournalEvents).toBe(0);
  });

  it('adds audit issues for non-terminal and malformed turn journal state', () => {
    const audit = auditSessionTranscript('s1', [], {
      sessionId: 's1',
      path: '/tmp/s1.jsonl',
      exists: true,
      totalEventCount: 1,
      malformedLineCount: 2,
      pendingTurnCount: 1,
      events: [
        {
          schemaVersion: 1,
          type: 'turn_started',
          sessionId: 's1',
          ts: 1000,
          turnId: 'turn-1',
        },
      ],
      turns: [
        {
          turnId: 'turn-1',
          startedAt: 1000,
          updatedAt: 1000,
          latestType: 'turn_started',
          status: 'running',
          eventCount: 1,
          messageCount: 0,
          traceStepCount: 0,
        },
      ],
    });

    expect(audit.issueCount).toBe(2);
    expect(audit.pendingJournalTurns).toBe(1);
    expect(audit.malformedJournalEvents).toBe(2);
    expect(audit.issues.map((issue) => issue.kind)).toEqual([
      'turn_journal_malformed_event',
      'turn_journal_pending_turn',
    ]);
  });

  it('repairs missing user messages from recoverable turn submissions', () => {
    const journal = {
      sessionId: 's1',
      path: '/tmp/s1.jsonl',
      exists: true,
      totalEventCount: 2,
      malformedLineCount: 0,
      pendingTurnCount: 1,
      events: [
        {
          schemaVersion: 1 as const,
          type: 'turn_submitted' as const,
          sessionId: 's1',
          ts: 1000,
          turnId: 'turn-1',
          data: {
            messageId: 'm-recovered-user',
            recoverable: true,
            content: [{ type: 'text', text: 'Please fix the auth regression' }],
          },
        },
        {
          schemaVersion: 1 as const,
          type: 'turn_started' as const,
          sessionId: 's1',
          ts: 1001,
          turnId: 'turn-1',
        },
      ],
      turns: [
        {
          turnId: 'turn-1',
          startedAt: 1000,
          updatedAt: 1001,
          latestType: 'turn_started' as const,
          status: 'running' as const,
          eventCount: 2,
          messageCount: 0,
          traceStepCount: 0,
        },
      ],
    };

    const audit = auditSessionTranscript('s1', [], journal);

    expect(audit.missingJournalUserMessages).toBe(1);
    expect(audit.pendingJournalTurns).toBe(1);

    const repaired = repairSessionTranscript('s1', [], journal);

    expect(repaired.changed).toBe(true);
    expect(repaired.injectedJournalUserMessages).toBe(1);
    expect(repaired.injectedJournalInterruptionMarkers).toBe(1);
    expect(repaired.audit.missingJournalUserMessages).toBe(0);
    expect(repaired.audit.pendingJournalTurns).toBe(0);
    expect(repaired.messages[0]).toMatchObject({
      id: 'm-recovered-user',
      role: 'user',
      metadata: {
        recovery: {
          kind: 'user_turn_recovered',
          source: 'turn_journal',
          turnId: 'turn-1',
        },
      },
    });
    expect(repaired.messages[0]?.content).toEqual([
      { type: 'text', text: 'Please fix the auth regression' },
    ]);
  });

  it('does not repair unrecoverable submitted turns', () => {
    const journal = {
      sessionId: 's1',
      path: '/tmp/s1.jsonl',
      exists: true,
      totalEventCount: 1,
      malformedLineCount: 0,
      pendingTurnCount: 1,
      events: [
        {
          schemaVersion: 1 as const,
          type: 'turn_submitted' as const,
          sessionId: 's1',
          ts: 1000,
          turnId: 'turn-1',
          data: {
            recoverable: false,
            nonRecoverableTypes: ['image'],
            content: [],
          },
        },
      ],
      turns: [
        {
          turnId: 'turn-1',
          startedAt: 1000,
          updatedAt: 1000,
          latestType: 'turn_submitted' as const,
          status: 'running' as const,
          eventCount: 1,
          messageCount: 0,
          traceStepCount: 0,
        },
      ],
    };

    const repaired = repairSessionTranscript('s1', [], journal);

    expect(repaired.injectedJournalUserMessages).toBe(0);
    expect(repaired.audit.unrecoverableJournalSubmissions).toBe(1);
    expect(repaired.messages.every((message) => message.role !== 'user')).toBe(true);
  });

  it('repairs simple transcript structure issues', () => {
    const repaired = repairSessionTranscript('s1', [
      {
        id: 'm-empty',
        sessionId: 's1',
        role: 'assistant',
        content: [],
        timestamp: 1,
      },
      {
        id: 'm-tool-use',
        sessionId: 's1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { path: 'src/index.ts' },
          },
        ],
        timestamp: 2,
      },
      {
        id: 'm-orphan-result',
        sessionId: 's1',
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'missing-tool',
            content: 'not found',
          },
        ],
        timestamp: 3,
      },
    ]);

    expect(repaired.changed).toBe(true);
    expect(repaired.removedEmptyMessages).toBe(2);
    expect(repaired.removedOrphanToolResults).toBe(1);
    expect(repaired.injectedSyntheticToolResults).toBe(1);
    expect(repaired.injectedJournalUserMessages).toBe(0);
    expect(repaired.injectedJournalInterruptionMarkers).toBe(0);
    expect(repaired.audit.issueCount).toBe(0);
  });

  it('repairs non-terminal journal turns with an idempotent interruption marker', () => {
    const journal = {
      sessionId: 's1',
      path: '/tmp/s1.jsonl',
      exists: true,
      totalEventCount: 1,
      malformedLineCount: 0,
      pendingTurnCount: 1,
      events: [
        {
          schemaVersion: 1 as const,
          type: 'turn_started' as const,
          sessionId: 's1',
          ts: 1000,
          turnId: 'turn-1',
        },
      ],
      turns: [
        {
          turnId: 'turn-1',
          startedAt: 1000,
          updatedAt: 1000,
          latestType: 'turn_started' as const,
          status: 'running' as const,
          eventCount: 1,
          messageCount: 0,
          traceStepCount: 0,
        },
      ],
    };

    const repaired = repairSessionTranscript('s1', [], journal);

    expect(repaired.changed).toBe(true);
    expect(repaired.injectedJournalInterruptionMarkers).toBe(1);
    expect(repaired.audit.pendingJournalTurns).toBe(0);
    expect(repaired.messages[0]?.metadata?.recovery).toMatchObject({
      kind: 'turn_interrupted',
      source: 'turn_journal',
      turnId: 'turn-1',
    });
    expect(repaired.messages[0]?.content[0]).toMatchObject({
      type: 'text',
    });

    const repairedAgain = repairSessionTranscript('s1', repaired.messages, journal);

    expect(repairedAgain.changed).toBe(false);
    expect(repairedAgain.injectedJournalInterruptionMarkers).toBe(0);
    expect(repairedAgain.messages).toHaveLength(1);
  });
});
