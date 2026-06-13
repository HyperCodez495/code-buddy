import type { ContentBlock, Message, Session, TraceStep } from '../../renderer/types';
import type { TurnJournalReadResult, TurnJournalTurnSummary } from './turn-journal';

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
  turnJournal?: TurnJournalReadResult;
  memoryPreview?: SessionMemoryPreview | null;
}

export interface SessionRecallPrefillEntry {
  sessionId: string;
  title: string;
  cwd?: string;
  updatedAt: number;
  score: number;
  snippet: string;
  messageIds: string[];
}

export interface SessionRecallPrefill {
  prompt: string;
  text: string;
  entries: SessionRecallPrefillEntry[];
  totalCandidateCount: number;
  maxChars: number;
  truncated: boolean;
}

export interface SessionRecallPrefillOptions {
  currentSessionId?: string;
  cwd?: string;
  limit?: number;
  maxChars?: number;
  perSessionMaxChars?: number;
}

export interface SessionTranscriptAuditIssue {
  kind:
    | 'orphan_tool_result'
    | 'missing_tool_result'
    | 'empty_message'
    | 'turn_journal_pending_turn'
    | 'turn_journal_missing_user_message'
    | 'turn_journal_unrecoverable_submission'
    | 'turn_journal_malformed_event';
  messageId?: string;
  toolUseId?: string;
  turnId?: string;
  detail: string;
}

export interface SessionTranscriptAudit {
  sessionId: string;
  issueCount: number;
  orphanToolResults: number;
  missingToolResults: number;
  emptyMessages: number;
  pendingJournalTurns: number;
  missingJournalUserMessages: number;
  unrecoverableJournalSubmissions: number;
  malformedJournalEvents: number;
  issues: SessionTranscriptAuditIssue[];
}

export interface SessionTranscriptRepairResult {
  sessionId: string;
  changed: boolean;
  removedOrphanToolResults: number;
  injectedSyntheticToolResults: number;
  injectedJournalUserMessages: number;
  injectedJournalInterruptionMarkers: number;
  removedEmptyMessages: number;
  messages: Message[];
  audit: SessionTranscriptAudit;
}

export interface SessionMemoryPreview {
  sessionId: string;
  projectId?: string | null;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  automatedMemoryEnabled: boolean;
  projectMemoryAvailable: boolean;
  projectMemoryPath?: string;
  projectContextAvailable: boolean;
  icmAvailable: boolean;
  recallEnabled: boolean;
  candidateCount: number;
  candidates: Array<{
    category: 'preference' | 'pattern' | 'context' | 'decision';
    content: string;
    sourceSessionId?: string;
    sourceKind: 'user' | 'assistant';
    evidence: string;
  }>;
}

export interface SessionInsightsSource {
  listSessions(): Session[];
  getMessages(sessionId: string): Message[];
  getTraceSteps(sessionId: string): TraceStep[];
  getTurnJournal?(sessionId: string): TurnJournalReadResult;
  getMemoryPreview?(sessionId: string): SessionMemoryPreview | null;
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

function normalizeSearchTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_\p{L}\p{N}-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
  return Array.from(new Set(terms)).slice(0, 16);
}

function countTermHits(text: string, terms: string[]): number {
  if (!text || terms.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index >= 0) {
      score += 1;
      index = lower.indexOf(term, index + term.length);
    }
  }
  return score;
}

function trimSnippet(text: string, terms: string[], maxChars: number): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return '';
  const lower = normalizedText.toLowerCase();
  const firstIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const safeMax = Math.max(120, maxChars);
  if (firstIndex === undefined) {
    return normalizedText.length > safeMax
      ? `${normalizedText.slice(0, safeMax - 3)}...`
      : normalizedText;
  }

  const start = Math.max(0, firstIndex - Math.floor(safeMax / 3));
  const end = Math.min(normalizedText.length, start + safeMax);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

function buildRecallText(entries: SessionRecallPrefillEntry[], maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (entries.length === 0) {
    return { text: '', truncated: false };
  }

  const lines = [
    '<session_recall_context>',
    'Relevant prior Cowork sessions. Use these as pointers to durable context, not as authoritative facts if the current workspace contradicts them.',
  ];

  let truncated = false;
  for (const entry of entries) {
    const item = [
      `- ${entry.title} (${entry.sessionId})`,
      entry.cwd ? `  Workspace: ${entry.cwd}` : null,
      `  Updated: ${new Date(entry.updatedAt).toISOString()}`,
      `  Match score: ${entry.score.toFixed(2)}`,
      `  Snippet: ${entry.snippet}`,
    ]
      .filter(Boolean)
      .join('\n');
    const projected = [...lines, item, '</session_recall_context>'].join('\n');
    if (projected.length > maxChars) {
      truncated = true;
      break;
    }
    lines.push(item);
  }

  lines.push('</session_recall_context>');
  return { text: lines.join('\n'), truncated };
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
  messages: Message[],
  turnJournal?: TurnJournalReadResult
): SessionTranscriptAudit {
  const toolUseIds = new Map<string, string>();
  const toolResultIds = new Map<string, string[]>();
  const issues: SessionTranscriptAuditIssue[] = [];
  const recoveryMarkerTurnIds = getRecoveryMarkerTurnIds(messages);
  const userMessageTurnIds = getUserMessageTurnIds(messages);

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

  if (turnJournal) {
    if (turnJournal.malformedLineCount > 0) {
      issues.push({
        kind: 'turn_journal_malformed_event',
        detail: `${turnJournal.malformedLineCount} malformed turn journal event(s) need manual review.`,
      });
    }

    const submissions = getTurnSubmissions(turnJournal);
    for (const submission of submissions) {
      if (userMessageTurnIds.has(submission.turnId)) continue;
      if (!submission.recoverable) {
        issues.push({
          kind: 'turn_journal_unrecoverable_submission',
          turnId: submission.turnId,
          detail: `Turn journal has a submitted user turn that cannot be safely reconstructed (${submission.reason}).`,
        });
        continue;
      }
      issues.push({
        kind: 'turn_journal_missing_user_message',
        turnId: submission.turnId,
        detail: `Turn journal has a recoverable submitted user turn that is missing from the transcript.`,
      });
    }

    for (const turn of turnJournal.turns) {
      if (turn.status !== 'running') continue;
      if (recoveryMarkerTurnIds.has(turn.turnId)) continue;
      issues.push({
        kind: 'turn_journal_pending_turn',
        turnId: turn.turnId,
        detail: `Turn journal has a non-terminal turn at ${new Date(turn.updatedAt).toISOString()} (${turn.latestType}).`,
      });
    }
  }

  return {
    sessionId,
    issueCount: issues.length,
    orphanToolResults: issues.filter((issue) => issue.kind === 'orphan_tool_result').length,
    missingToolResults: issues.filter((issue) => issue.kind === 'missing_tool_result').length,
    emptyMessages: issues.filter((issue) => issue.kind === 'empty_message').length,
    pendingJournalTurns: issues.filter((issue) => issue.kind === 'turn_journal_pending_turn')
      .length,
    missingJournalUserMessages: issues.filter(
      (issue) => issue.kind === 'turn_journal_missing_user_message'
    ).length,
    unrecoverableJournalSubmissions: issues.filter(
      (issue) => issue.kind === 'turn_journal_unrecoverable_submission'
    ).length,
    malformedJournalEvents: turnJournal?.malformedLineCount ?? 0,
    issues,
  };
}

export function repairSessionTranscript(
  sessionId: string,
  messages: Message[],
  turnJournal?: TurnJournalReadResult
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
  let injectedJournalUserMessages = 0;
  let injectedJournalInterruptionMarkers = 0;
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
  const userMessageTurnIds = getUserMessageTurnIds(repaired);
  if (turnJournal) {
    for (const submission of getTurnSubmissions(turnJournal)) {
      if (!submission.recoverable || userMessageTurnIds.has(submission.turnId)) continue;
      injectedJournalUserMessages += 1;
      repaired.push(buildJournalRecoveredUserMessage(sessionId, submission));
      userMessageTurnIds.add(submission.turnId);
    }
  }

  const recoveryMarkerTurnIds = getRecoveryMarkerTurnIds(repaired);

  if (turnJournal) {
    for (const turn of turnJournal.turns) {
      if (turn.status !== 'running') continue;
      if (recoveryMarkerTurnIds.has(turn.turnId)) continue;
      injectedJournalInterruptionMarkers += 1;
      repaired.push(buildJournalInterruptionMarker(sessionId, turn));
      recoveryMarkerTurnIds.add(turn.turnId);
    }
  }

  return {
    sessionId,
    changed: changed || injectedJournalUserMessages > 0 || injectedJournalInterruptionMarkers > 0,
    removedOrphanToolResults,
    injectedSyntheticToolResults,
    injectedJournalUserMessages,
    injectedJournalInterruptionMarkers,
    removedEmptyMessages,
    messages: repaired,
    audit: auditSessionTranscript(sessionId, repaired, turnJournal),
  };
}

function getRecoveryMarkerTurnIds(messages: Message[]): Set<string> {
  const turnIds = new Set<string>();
  for (const message of messages) {
    const recovery = message.metadata?.recovery;
    if (recovery?.kind === 'turn_interrupted' && recovery.source === 'turn_journal') {
      turnIds.add(recovery.turnId);
    }
  }
  return turnIds;
}

function getUserMessageTurnIds(messages: Message[]): Set<string> {
  const turnIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (message.metadata?.turn?.id) {
      turnIds.add(message.metadata.turn.id);
    }
    const recovery = message.metadata?.recovery;
    if (recovery?.kind === 'user_turn_recovered' && recovery.source === 'turn_journal') {
      turnIds.add(recovery.turnId);
    }
  }
  return turnIds;
}

interface TurnSubmissionSnapshot {
  turnId: string;
  ts: number;
  messageId: string;
  content: ContentBlock[];
  recoverable: boolean;
  reason: string;
}

function getTurnSubmissions(turnJournal: TurnJournalReadResult): TurnSubmissionSnapshot[] {
  const submissions = new Map<string, TurnSubmissionSnapshot>();
  for (const event of turnJournal.events) {
    if (event.type !== 'turn_submitted' || !event.turnId) continue;
    const parsed = parseTurnSubmission(event.turnId, event.ts, event.data);
    submissions.set(event.turnId, parsed);
  }
  return [...submissions.values()];
}

function parseTurnSubmission(
  turnId: string,
  ts: number,
  data: Record<string, unknown> | undefined
): TurnSubmissionSnapshot {
  const messageId = typeof data?.messageId === 'string' && data.messageId.trim()
    ? data.messageId
    : `journal-user-${safeMarkerId(turnId)}`;
  const content = parseRecoverableContentBlocks(data?.content);
  const flaggedRecoverable = data?.recoverable === true;
  const recoverable = flaggedRecoverable && content.length > 0;
  const nonRecoverableTypes = Array.isArray(data?.nonRecoverableTypes)
    ? data.nonRecoverableTypes.filter((type): type is string => typeof type === 'string')
    : [];
  const reason = recoverable
    ? 'recoverable'
    : nonRecoverableTypes.length > 0
      ? `non-recoverable block types: ${nonRecoverableTypes.join(', ')}`
      : 'missing or invalid recoverable content snapshot';

  return {
    turnId,
    ts,
    messageId,
    content,
    recoverable,
    reason,
  };
}

function parseRecoverableContentBlocks(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: ContentBlock[] = [];
  for (const block of value) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      blocks.push({ type: 'text', text: candidate.text });
      continue;
    }
    if (
      candidate.type === 'file_attachment' &&
      typeof candidate.filename === 'string' &&
      typeof candidate.relativePath === 'string' &&
      typeof candidate.size === 'number'
    ) {
      blocks.push({
        type: 'file_attachment',
        filename: candidate.filename,
        relativePath: candidate.relativePath,
        size: candidate.size,
        ...(typeof candidate.mimeType === 'string' ? { mimeType: candidate.mimeType } : {}),
      });
    }
  }
  return blocks;
}

function buildJournalRecoveredUserMessage(
  sessionId: string,
  submission: TurnSubmissionSnapshot
): Message {
  return {
    id: submission.messageId,
    sessionId,
    role: 'user',
    content: submission.content,
    timestamp: submission.ts,
    metadata: {
      turn: {
        id: submission.turnId,
        role: 'user',
      },
      recovery: {
        kind: 'user_turn_recovered',
        source: 'turn_journal',
        turnId: submission.turnId,
        status: 'message',
        reason: 'missing_transcript_user_message',
      },
    },
  };
}

function buildJournalInterruptionMarker(
  sessionId: string,
  turn: TurnJournalTurnSummary
): Message {
  const updatedAt = new Date(turn.updatedAt).toISOString();
  return {
    id: `journal-interrupted-${safeMarkerId(turn.turnId)}`,
    sessionId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text:
          '**Response interrupted.**\n\n' +
          `Turn ${turn.turnId} did not reach a terminal journal state. ` +
          `Last journal event: ${turn.latestType} at ${updatedAt}.`,
      },
    ],
    timestamp: turn.updatedAt + 1,
    metadata: {
      turn: {
        id: turn.turnId,
        role: 'assistant',
      },
      recovery: {
        kind: 'turn_interrupted',
        source: 'turn_journal',
        turnId: turn.turnId,
        status: 'marker',
        reason: turn.latestType,
      },
    },
  };
}

function safeMarkerId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_');
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

export function buildSessionRecallPrefill(
  prompt: string,
  source: SessionInsightsSource,
  options: SessionRecallPrefillOptions = {}
): SessionRecallPrefill {
  const normalizedPrompt = prompt.trim();
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
  const maxChars = Math.max(0, Math.min(options.maxChars ?? 6_000, 24_000));
  const perSessionMaxChars = Math.max(120, Math.min(options.perSessionMaxChars ?? 900, 4_000));
  if (!normalizedPrompt || maxChars === 0) {
    return {
      prompt: normalizedPrompt,
      text: '',
      entries: [],
      totalCandidateCount: 0,
      maxChars,
      truncated: false,
    };
  }

  const terms = normalizeSearchTerms(normalizedPrompt);
  if (terms.length === 0) {
    return {
      prompt: normalizedPrompt,
      text: '',
      entries: [],
      totalCandidateCount: 0,
      maxChars,
      truncated: false,
    };
  }

  const scored: SessionRecallPrefillEntry[] = [];
  for (const session of source.listSessions()) {
    if (session.id === options.currentSessionId) continue;
    const messages = source.getMessages(session.id);
    if (messages.length === 0) continue;

    const transcriptEntries = messages
      .map((message) => ({
        id: message.id,
        text: flattenMessageText(message),
      }))
      .filter((entry) => Boolean(entry.text));
    const transcript = transcriptEntries.map((entry) => entry.text).join('\n\n');
    const metadata = [session.title, session.model, session.cwd, ...(session.tags ?? [])]
      .filter(Boolean)
      .join('\n');
    const titleScore = countTermHits(session.title, terms) * 8;
    const metadataScore = countTermHits(metadata, terms) * 3;
    const transcriptScore = countTermHits(transcript, terms);
    const workspaceBoost =
      options.cwd && session.cwd && options.cwd === session.cwd ? Math.min(6, terms.length * 2) : 0;
    const recencyBoost = Math.max(0, 1 - (Date.now() - session.updatedAt) / 2_592_000_000);
    const score = titleScore + metadataScore + transcriptScore + workspaceBoost + recencyBoost;
    if (score <= 0) continue;

    const matchingMessageIds = transcriptEntries
      .filter((entry) => countTermHits(entry.text, terms) > 0)
      .map((entry) => entry.id)
      .slice(0, 5);

    scored.push({
      sessionId: session.id,
      title: session.title,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      score,
      snippet: trimSnippet(transcript || buildPreview(messages), terms, perSessionMaxChars),
      messageIds: matchingMessageIds,
    });
  }

  const entries = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, limit);
  const built = buildRecallText(entries, maxChars);

  return {
    prompt: normalizedPrompt,
    text: built.text,
    entries,
    totalCandidateCount: scored.length,
    maxChars,
    truncated: built.truncated,
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
      turnJournal: this.source.getTurnJournal?.(sessionId),
      memoryPreview: this.source.getMemoryPreview?.(sessionId) ?? null,
    };
  }

  getRecallPrefill(
    prompt: string,
    options: SessionRecallPrefillOptions = {}
  ): SessionRecallPrefill {
    return buildSessionRecallPrefill(prompt, this.source, options);
  }

  getAudit(sessionId: string): SessionTranscriptAudit | null {
    const session = this.source.listSessions().find((entry) => entry.id === sessionId);
    if (!session) return null;
    return auditSessionTranscript(
      sessionId,
      this.source.getMessages(sessionId),
      this.source.getTurnJournal?.(sessionId)
    );
  }

  repair(sessionId: string): SessionTranscriptRepairResult | null {
    const session = this.source.listSessions().find((entry) => entry.id === sessionId);
    if (!session) return null;
    const turnJournal = this.source.getTurnJournal?.(sessionId);
    const result = repairSessionTranscript(
      sessionId,
      this.source.getMessages(sessionId),
      turnJournal
    );
    if (result.changed) {
      this.source.replaceMessages?.(sessionId, result.messages);
    }
    return {
      ...result,
      audit: auditSessionTranscript(sessionId, result.messages, turnJournal),
    };
  }
}
