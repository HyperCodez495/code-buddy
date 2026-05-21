import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFocusedMessageTarget,
  formatRelativeTime,
  groupByWorkspace,
  type SessionResumeSummary,
} from '../src/renderer/components/session-resume-helpers';

const sessionResumePath = path.resolve(
  process.cwd(),
  'src/renderer/components/SessionResumeDialog.tsx'
);
const sessionResumeHelperPath = path.resolve(
  process.cwd(),
  'src/renderer/components/session-resume-helpers.ts'
);

function summary(overrides: Partial<SessionResumeSummary>): SessionResumeSummary {
  return {
    sessionId: 'session-1',
    title: 'Session 1',
    status: 'idle',
    cwd: 'D:/CascadeProjects/grok-cli-weekend',
    createdAt: 1,
    updatedAt: 1,
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    toolCallCount: 0,
    tokenInput: 0,
    tokenOutput: 0,
    totalTokens: 0,
    totalExecutionTimeMs: 0,
    transcriptPreview: 'preview',
    ...overrides,
  };
}

describe('SessionResumeDialog search resume behavior', () => {
  it('preserves match snippets and focuses the matched message when resuming search results', () => {
    const source = fs.readFileSync(sessionResumePath, 'utf8');
    const helperSource = fs.readFileSync(sessionResumeHelperPath, 'utf8');

    expect(helperSource).toContain('matchSnippet?: string');
    expect(helperSource).toContain('matchRole?: string');
    expect(helperSource).toContain('matchMessageId?: string');
    expect(source).toContain('setFocusedMessageTarget');
    expect(source).toContain('buildFocusedMessageTarget(selectedSummary, query)');
    expect(source).toContain('selectedSummary.matchRole');
    expect(source).toContain("t('sessionResume.searchMatch'");
  });

  it('builds a focus target only for a searched matched message', () => {
    expect(
      buildFocusedMessageTarget(
        summary({ sessionId: 'session-abc', matchMessageId: 'message-123' }),
        'banana',
      ),
    ).toEqual({ sessionId: 'session-abc', messageId: 'message-123' });

    expect(
      buildFocusedMessageTarget(
        summary({ sessionId: 'session-abc', matchMessageId: 'message-123' }),
        '   ',
      ),
    ).toBeNull();
    expect(buildFocusedMessageTarget(summary({ matchMessageId: undefined }), 'banana')).toBeNull();
  });

  it('groups sessions by workspace and keeps the no-workspace bucket explicit', () => {
    const grouped = groupByWorkspace([
      summary({ sessionId: 'a', cwd: 'D:/A' }),
      summary({ sessionId: 'b', cwd: undefined }),
      summary({ sessionId: 'c', cwd: 'D:/A' }),
    ]);

    expect(grouped.map(([workspace]) => workspace)).toEqual(['D:/A', 'No workspace']);
    expect(grouped[0][1].map((item) => item.sessionId)).toEqual(['a', 'c']);
    expect(grouped[1][1].map((item) => item.sessionId)).toEqual(['b']);
  });

  it('formats relative times with deterministic boundaries', () => {
    const now = Date.UTC(2026, 4, 16, 19, 0);

    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3d ago');
  });
});
