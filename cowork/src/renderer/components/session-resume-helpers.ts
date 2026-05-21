import type { Message, TraceStep } from '../types';

export interface SessionResumeSummary {
  sessionId: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  model?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  tokenInput: number;
  tokenOutput: number;
  totalTokens: number;
  totalExecutionTimeMs: number;
  transcriptPreview: string;
  matchSnippet?: string;
  matchRole?: string;
  matchCount?: number;
  matchMessageId?: string;
}

export interface SessionResumeDetail {
  summary: SessionResumeSummary;
  messages: Message[];
  traceSteps: TraceStep[];
}

export interface FocusedMessageTarget {
  sessionId: string;
  messageId: string;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const delta = now - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function groupByWorkspace(
  items: SessionResumeSummary[],
): Array<[string, SessionResumeSummary[]]> {
  const groups = new Map<string, SessionResumeSummary[]>();
  for (const item of items) {
    const key = item.cwd || 'No workspace';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries());
}

export function buildFocusedMessageTarget(
  summary: SessionResumeSummary | null,
  query: string,
): FocusedMessageTarget | null {
  if (!summary?.matchMessageId || !query.trim()) {
    return null;
  }
  return {
    sessionId: summary.sessionId,
    messageId: summary.matchMessageId,
  };
}
