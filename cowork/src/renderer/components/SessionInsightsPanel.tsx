import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  X,
  Search,
  Loader2,
  MessageSquare,
  Wrench,
  Clock3,
  FolderOpen,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { Message, TraceStep } from '../types';
import { formatAppDateTime } from '../utils/i18n-format';

interface SessionInsightSummary {
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
  matchCount?: number;
  matchMessageId?: string;
}

interface SessionInsightDetail {
  summary: SessionInsightSummary;
  messages: Message[];
  traceSteps: TraceStep[];
}

interface SessionTranscriptAudit {
  sessionId: string;
  issueCount: number;
  orphanToolResults: number;
  missingToolResults: number;
  emptyMessages: number;
  issues: Array<{
    kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
    messageId?: string;
    toolUseId?: string;
    detail: string;
  }>;
}

interface SessionInsightsPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function flattenMessageText(message: Message): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thinking;
      if (block.type === 'tool_result') return block.content;
      if (block.type === 'tool_use') return `[${block.name}]`;
      if (block.type === 'file_attachment') return `[file] ${block.filename}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export const SessionInsightsPanel: React.FC<SessionInsightsPanelProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const setFocusedMessageTarget = useAppStore((s) => s.setFocusedMessageTarget);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SessionInsightSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionInsightDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [repairingAudit, setRepairingAudit] = useState(false);
  const [audit, setAudit] = useState<SessionTranscriptAudit | null>(null);

  const loadList = useCallback(async () => {
    if (!window.electronAPI?.sessionInsights) return;
    setLoadingList(true);
    try {
      const result = query.trim()
        ? await window.electronAPI.sessionInsights.search(query.trim(), 100)
        : await window.electronAPI.sessionInsights.list(100);
      setItems(result as SessionInsightSummary[]);
      setSelectedId((current) => current ?? result[0]?.sessionId ?? null);
    } finally {
      setLoadingList(false);
    }
  }, [query]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open || !selectedId || !window.electronAPI?.sessionInsights?.detail) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void window.electronAPI.sessionInsights.detail(selectedId).then((result) => {
      if (!cancelled) {
        setDetail(result as SessionInsightDetail | null);
        setLoadingDetail(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const selectedSummary = useMemo(
    () => items.find((item) => item.sessionId === selectedId) ?? null,
    [items, selectedId]
  );

  const openSession = useCallback(() => {
    if (!detail) return;
    setMessages(detail.summary.sessionId, detail.messages);
    setTraceSteps(detail.summary.sessionId, detail.traceSteps);
    setActiveSession(detail.summary.sessionId);
    onClose();
  }, [detail, onClose, setActiveSession, setMessages, setTraceSteps]);

  const openSessionAtMessage = useCallback(
    (messageId: string) => {
      if (!detail) return;
      setMessages(detail.summary.sessionId, detail.messages);
      setTraceSteps(detail.summary.sessionId, detail.traceSteps);
      setFocusedMessageTarget({
        sessionId: detail.summary.sessionId,
        messageId,
      });
      setActiveSession(detail.summary.sessionId);
      onClose();
    },
    [detail, onClose, setActiveSession, setFocusedMessageTarget, setMessages, setTraceSteps]
  );

  const loadAudit = useCallback(async () => {
    if (!selectedId || !window.electronAPI?.sessionInsights?.audit) {
      return;
    }
    setLoadingAudit(true);
    try {
      const result = await window.electronAPI.sessionInsights.audit(selectedId);
      setAudit(result as SessionTranscriptAudit | null);
    } finally {
      setLoadingAudit(false);
    }
  }, [selectedId]);

  const repairAudit = useCallback(async () => {
    if (!selectedId || !window.electronAPI?.sessionInsights?.repair) {
      return;
    }
    setRepairingAudit(true);
    try {
      const result = await window.electronAPI.sessionInsights.repair(selectedId);
      if (result) {
        setAudit(result.audit as SessionTranscriptAudit);
        setMessages(selectedId, result.messages);
        setDetail((current) =>
          current && current.summary.sessionId === selectedId
            ? { ...current, messages: result.messages }
            : current
        );
        if (activeSessionId === selectedId) {
          setActiveSession(selectedId);
        }
      }
    } finally {
      setRepairingAudit(false);
    }
  }, [activeSessionId, selectedId, setActiveSession, setMessages]);

  useEffect(() => {
    setAudit(null);
  }, [selectedId]);

  if (!open) return null;

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-[760px] max-w-[96vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col"
      data-testid="session-insights-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('sessionInsights.title', 'Session insights')}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('sessionInsights.count', { count: items.length })}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-border-muted shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('sessionInsights.searchPlaceholder', 'Search sessions and transcripts…')}
            className="w-full rounded-xl border border-transparent bg-surface pl-9 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border"
            data-testid="session-insights-search"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
        <div className="border-r border-border-muted overflow-y-auto">
          {loadingList && (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('common.loading')}
            </div>
          )}

          {!loadingList && items.length === 0 && (
            <div
              className="px-4 py-12 text-center text-xs text-text-muted"
              data-testid="session-insights-empty"
            >
              {t('sessionInsights.empty', 'No sessions found')}
            </div>
          )}

          {!loadingList &&
            items.map((item) => (
              <button
                key={item.sessionId}
                onClick={() => setSelectedId(item.sessionId)}
                data-testid={`session-insights-row-${item.sessionId}`}
                className={`w-full px-4 py-3 text-left border-b border-border-muted transition-colors ${
                  selectedId === item.sessionId ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="text-xs font-medium text-text-primary truncate">{item.title}</div>
                <div className="text-[11px] text-text-muted mt-0.5 truncate">
                  {item.model || t('sessionInsights.unknownModel', 'Unknown model')}
                </div>
                {query.trim() && item.matchSnippet && (
                  <div className="mt-1 text-[11px] text-text-secondary line-clamp-2">
                    {item.matchSnippet}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare size={10} /> {item.messageCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Wrench size={10} /> {item.toolCallCount}
                  </span>
                  {query.trim() && typeof item.matchCount === 'number' && item.matchCount > 0 && (
                    <span>{t('sessionInsights.matches', { count: item.matchCount })}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={10} /> {formatDuration(item.totalExecutionTimeMs)}
                  </span>
                </div>
              </button>
            ))}
        </div>

        <div className="flex flex-col min-h-0">
          {!selectedSummary && (
            <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
              {t('sessionInsights.selectHint', 'Select a session to inspect')}
            </div>
          )}

          {selectedSummary && (
            <>
              <div className="px-4 py-3 border-b border-border-muted shrink-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      {selectedSummary.title}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {selectedSummary.model || t('sessionInsights.unknownModel', 'Unknown model')}
                    </div>
                  </div>
                  <button
                    onClick={openSession}
                    disabled={!detail}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    <ArrowRight size={12} />
                    {t('sessionInsights.openSession', 'Open session')}
                  </button>
                  <button
                    onClick={() => void loadAudit()}
                    disabled={loadingAudit}
                    data-testid="session-insights-audit-button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                  >
                    {loadingAudit ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t('sessionInsights.auditTranscript', 'Audit transcript')}
                  </button>
                  <button
                    onClick={() => void repairAudit()}
                    disabled={repairingAudit}
                    data-testid="session-insights-repair-button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                  >
                    {repairingAudit ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t('sessionInsights.repairTranscript', 'Repair transcript')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                  <div>
                    {t('sessionInsights.messages', 'Messages')}: {selectedSummary.messageCount}
                  </div>
                  <div>
                    {t('sessionInsights.tools', 'Tool calls')}: {selectedSummary.toolCallCount}
                  </div>
                  <div>
                    {t('sessionInsights.tokens', 'Tokens')}:{' '}
                    {formatTokenCount(selectedSummary.totalTokens)}
                  </div>
                  <div>
                    {t('sessionInsights.duration', 'Runtime')}:{' '}
                    {formatDuration(selectedSummary.totalExecutionTimeMs)}
                  </div>
                </div>

                {selectedSummary.cwd && (
                  <div className="inline-flex items-center gap-1 text-[11px] text-text-muted break-all">
                    <FolderOpen size={11} />
                    {selectedSummary.cwd}
                  </div>
                )}

                {audit && (
                  <div
                    className="rounded-lg border border-border-muted bg-surface px-3 py-3 space-y-2"
                    data-testid="session-insights-audit-result"
                  >
                    <div className="text-xs font-medium text-text-primary">
                      {t('sessionInsights.auditTitle', 'Transcript audit')}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                      <div>{t('sessionInsights.auditIssues', { count: audit.issueCount })}</div>
                      <div>{t('sessionInsights.auditMissingResults', { count: audit.missingToolResults })}</div>
                      <div>{t('sessionInsights.auditOrphans', { count: audit.orphanToolResults })}</div>
                      <div>{t('sessionInsights.auditEmptyMessages', { count: audit.emptyMessages })}</div>
                    </div>
                    {audit.issueCount === 0 ? (
                      <div className="text-[11px] text-success">
                        {t('sessionInsights.auditClean', 'No transcript issues detected')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {audit.issues.map((issue, index) => (
                          <div
                            key={`${issue.kind}-${issue.messageId || issue.toolUseId || index}`}
                            className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-text-primary">{issue.kind}</div>
                                <div className="mt-1 text-text-muted break-words">{issue.detail}</div>
                              </div>
                              {issue.messageId && (
                                <button
                                  type="button"
                                  onClick={() => openSessionAtMessage(issue.messageId!)}
                                  className="shrink-0 text-accent hover:text-accent-hover"
                                  title={t('sessionInsights.jumpToMessage', 'Open this message in Chat')}
                                >
                                  <ArrowRight size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                {loadingDetail && (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    {t('common.loading')}
                  </div>
                )}

                {!loadingDetail &&
                  detail?.messages.map((message) => {
                    const text = flattenMessageText(message);
                    return (
                      <div
                        key={message.id}
                        className="rounded-lg border border-border-muted overflow-hidden"
                      >
                        <div className="px-3 py-2 bg-surface flex items-center justify-between text-[11px]">
                          <span className="font-medium text-text-primary">{message.role}</span>
                          <button
                            type="button"
                            onClick={() => openSessionAtMessage(message.id)}
                            className="text-text-muted hover:text-text-primary transition-colors"
                            title={t('sessionInsights.jumpToMessage', 'Open this message in Chat')}
                          >
                            {formatAppDateTime(message.timestamp)}
                          </button>
                        </div>
                        <div className="px-3 py-2 text-xs text-text-secondary whitespace-pre-wrap break-words">
                          {text ||
                            t('sessionInsights.noRenderableContent', 'No renderable text content')}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
