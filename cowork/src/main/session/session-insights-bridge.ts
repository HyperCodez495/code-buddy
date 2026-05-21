import type { Message, Session, TraceStep } from '../../renderer/types';

export interface SessionInsightSummary {
  sessionId: string;
  title: string;
  status: Session['status'];
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

export interface SessionInsightDetail {
  summary: SessionInsightSummary;
  messages: Message[];
  traceSteps: TraceStep[];
}

export interface SessionTranscriptAuditIssue {
  kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
  messageId?: string;
  toolUseId?: string;
  detail: string;
}

export interface SessionTranscriptAudit {
  sessionId: string;
  issueCount: number;
  orphanToolResults: number;
  missingToolResults: number;
  emptyMessages: number;
  issues: SessionTranscriptAuditIssue[];
}

export interface SessionTranscriptRepairResult {
  sessionId: string;
  changed: boolean;
  removedOrphanToolResults: number;
  injectedSyntheticToolResults: number;
  removedEmptyMessages: number;
  messages: Message[];
  audit: SessionTranscriptAudit;
}

export interface SessionInsightsSource {
  listSessions(): Session[];
  getMessages(sessionId: string): Message[];
  getTraceSteps(sessionId: string): TraceStep[];
  replaceMessages?(sessionId: string, messages: Message[]): void;
}

function flattenMessageText(message: Message): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text);
    if (block.type === 'thinking') parts.push(block.thinking);
    if (block.type === 'tool_result') parts.push(block.content);
    if (block.type === 'tool_use') parts.push(`[${block.name}]`);
    if (block.type === 'file_attachment') parts.push(block.filename);
  }
  return parts.join('\n').trim();
}

function buildPreview(messages: Message[]): string {
  const text = messages
    .map(flattenMessageText)
    .filter(Boolean)
    .join('\n\n')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function buildMatchSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return '';
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return normalizedText.slice(0, 160);

  const lower = normalizedText.toLowerCase();
  const index = lower.indexOf(normalizedQuery);
  if (index < 0) {
    return normalizedText.length > 160 ? `${normalizedText.slice(0, 157)}...` : normalizedText;
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(normalizedText.length, index + normalizedQuery.length + 80);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

export function auditSessionTranscript(
  sessionId: string,
  messages: Message[]
): SessionTranscriptAudit {
  const toolUseIds = new Map<string, string>();
  const toolResultIds = new Map<string, string[]>();
  const issues: SessionTranscriptAuditIssue[] = [];

  for (const message of messages) {
    const hasRenderableContent = message.content.some((block) => {
      if (block.type === 'text') return block.text.trim().length > 0;
      if (block.type === 'thinking') return block.thinking.trim().length > 0;
      if (block.type === 'tool_result') return block.content.trim().length > 0 || block.images?.length;
      if (block.type === 'tool_use') return true;
      if (block.type === 'file_attachment') return true;
      return false;
    });

    if (!hasRenderableContent) {
      issues.push({
        kind: 'empty_message',
        messageId: message.id,
        detail: 'Message has no renderable content.',
      });
    }

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolUseIds.set(block.id, message.id);
      }
      if (block.type === 'tool_result') {
        const list = toolResultIds.get(block.toolUseId) || [];
        list.push(message.id);
        toolResultIds.set(block.toolUseId, list);
      }
    }
  }

  for (const [toolUseId, messageIds] of toolResultIds.entries()) {
    if (!toolUseIds.has(toolUseId)) {
      for (const messageId of messageIds) {
        issues.push({
          kind: 'orphan_tool_result',
          messageId,
          toolUseId,
          detail: `tool_result references unknown tool_use id "${toolUseId}".`,
        });
      }
    }
  }

  for (const [toolUseId, messageId] of toolUseIds.entries()) {
    if (!toolResultIds.has(toolUseId)) {
      issues.push({
        kind: 'missing_tool_result',
        messageId,
        toolUseId,
        detail: `tool_use "${toolUseId}" has no matching tool_result.`,
      });
    }
  }

  return {
    sessionId,
    issueCount: issues.length,
    orphanToolResults: issues.filter((issue) => issue.kind === 'orphan_tool_result').length,
    missingToolResults: issues.filter((issue) => issue.kind === 'missing_tool_result').length,
    emptyMessages: issues.filter((issue) => issue.kind === 'empty_message').length,
    issues,
  };
}

export function repairSessionTranscript(
  sessionId: string,
  messages: Message[]
): SessionTranscriptRepairResult {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolUseIds.add(block.id);
      }
      if (block.type === 'tool_result') {
        toolResultIds.add(block.toolUseId);
      }
    }
  }

  let removedOrphanToolResults = 0;
  let removedEmptyMessages = 0;
  let injectedSyntheticToolResults = 0;
  const repaired: Message[] = [];

  for (const message of messages) {
    const filteredContent = message.content.filter((block) => {
      if (block.type !== 'tool_result') {
        return true;
      }
      const keep = toolUseIds.has(block.toolUseId);
      if (!keep) {
        removedOrphanToolResults += 1;
      }
      return keep;
    });

    const hasRenderableContent = filteredContent.some((block) => {
      if (block.type === 'text') return block.text.trim().length > 0;
      if (block.type === 'thinking') return block.thinking.trim().length > 0;
      if (block.type === 'tool_result') return block.content.trim().length > 0 || Boolean(block.images?.length);
      if (block.type === 'tool_use') return true;
      if (block.type === 'file_attachment') return true;
      return false;
    });

    if (!hasRenderableContent) {
      removedEmptyMessages += 1;
      continue;
    }

    repaired.push({
      ...message,
      content: filteredContent,
    });

    for (const block of filteredContent) {
      if (block.type === 'tool_use' && !toolResultIds.has(block.id)) {
        injectedSyntheticToolResults += 1;
        repaired.push({
          id: `${message.id}:synthetic-result:${block.id}`,
          sessionId: message.sessionId,
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              toolUseId: block.id,
              content: '[result lost during transcript repair]',
              isError: true,
            },
          ],
          timestamp: message.timestamp + injectedSyntheticToolResults,
        });
      }
    }
  }

  const changed =
    removedOrphanToolResults > 0 || removedEmptyMessages > 0 || injectedSyntheticToolResults > 0;

  return {
    sessionId,
    changed,
    removedOrphanToolResults,
    injectedSyntheticToolResults,
    removedEmptyMessages,
    messages: repaired,
    audit: auditSessionTranscript(sessionId, repaired),
  };
}

export function buildSessionInsightSummary(
  session: Session,
  messages: Message[],
  traceSteps: TraceStep[]
): SessionInsightSummary {
  const userMessageCount = messages.filter((message) => message.role === 'user').length;
  const assistantMessageCount = messages.filter((message) => message.role === 'assistant').length;
  const tokenInput = messages.reduce((sum, message) => sum + (message.tokenUsage?.input ?? 0), 0);
  const tokenOutput = messages.reduce((sum, message) => sum + (message.tokenUsage?.output ?? 0), 0);
  const totalExecutionTimeMs = messages.reduce(
    (sum, message) => sum + (message.executionTimeMs ?? 0),
    0
  );
  const toolCallCount = traceSteps.filter((step) => step.type === 'tool_call').length;

  return {
    sessionId: session.id,
    title: session.title,
    status: session.status,
    model: session.model,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    tokenInput,
    tokenOutput,
    totalTokens: tokenInput + tokenOutput,
    totalExecutionTimeMs,
    transcriptPreview: buildPreview(messages),
  };
}

export class SessionInsightsBridge {
  constructor(private readonly source: SessionInsightsSource) {}

  list(limit = 100): SessionInsightSummary[] {
    return this.source
      .listSessions()
      .map((session) =>
        buildSessionInsightSummary(
          session,
          this.source.getMessages(session.id),
          this.source.getTraceSteps(session.id)
        )
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit));
  }

  search(query: string, limit = 50): SessionInsightSummary[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return this.list(limit);
    }

    const results: SessionInsightSummary[] = [];

    for (const session of this.source.listSessions()) {
      const messages = this.source.getMessages(session.id);
      const traceSteps = this.source.getTraceSteps(session.id);
      const summary = buildSessionInsightSummary(session, messages, traceSteps);
      const transcriptEntries = messages
        .map((message) => ({
          messageId: message.id,
          role: message.role,
          text: flattenMessageText(message),
        }))
        .filter((entry) => Boolean(entry.text));
      const fullTranscript = transcriptEntries.map((entry) => entry.text).join('\n\n');
      const metadataHaystack = [summary.title, summary.model, summary.cwd]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      const transcriptLower = fullTranscript.toLowerCase();
      const metadataMatch = metadataHaystack.includes(normalizedQuery);
      const transcriptMatch = transcriptLower.includes(normalizedQuery);
      if (!metadataMatch && !transcriptMatch) {
        continue;
      }

      const matchingEntries = transcriptEntries.filter((entry) =>
        entry.text.toLowerCase().includes(normalizedQuery)
      );

      results.push({
        ...summary,
        matchSnippet: transcriptMatch
          ? buildMatchSnippet(fullTranscript, normalizedQuery)
          : undefined,
        matchRole: matchingEntries[0]?.role,
        matchCount: matchingEntries.length,
        matchMessageId: matchingEntries[0]?.messageId,
      });
    }

    return results
      .sort((a, b) => {
        const aScore = a.matchCount ?? 0;
        const bScore = b.matchCount ?? 0;
        if (aScore !== bScore) {
          return bScore - aScore;
        }
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, Math.max(1, limit));
  }

  getDetail(sessionId: string): SessionInsightDetail | null {
    const session = this.source.listSessions().find((entry) => entry.id === sessionId);
    if (!session) return null;
    const messages = this.source.getMessages(sessionId);
    const traceSteps = this.source.getTraceSteps(sessionId);
    return {
      summary: buildSessionInsightSummary(session, messages, traceSteps),
      messages,
      traceSteps,
    };
  }

  getAudit(sessionId: string): SessionTranscriptAudit | null {
    const session = this.source.listSessions().find((entry) => entry.id === sessionId);
    if (!session) return null;
    return auditSessionTranscript(sessionId, this.source.getMessages(sessionId));
  }

  repair(sessionId: string): SessionTranscriptRepairResult | null {
    const session = this.source.listSessions().find((entry) => entry.id === sessionId);
    if (!session) return null;
    const result = repairSessionTranscript(sessionId, this.source.getMessages(sessionId));
    if (result.changed) {
      this.source.replaceMessages?.(sessionId, result.messages);
    }
    return result;
  }
}
