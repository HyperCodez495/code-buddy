/**
 * SubAgentResultCard — Aggregated multi-agent result visualization
 * Claude Cowork parity: shown inline in the chat after orchestrator runs.
 */
import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Bot,
  Clock,
  FileText,
  Users,
} from 'lucide-react';

export interface AggregatedSection {
  role: string;
  nickname: string;
  success: boolean;
  duration: number;
  summary: string;
  fullOutput: string;
  errors: string[];
}

export interface AggregatedArtifact {
  key: string;
  value: unknown;
  contributors: string[];
}

export interface AggregatedResult {
  totalAgents: number;
  successCount: number;
  failureCount: number;
  totalDuration: number;
  summary: string;
  sections: AggregatedSection[];
  artifacts: AggregatedArtifact[];
  errors: string[];
}

interface SubAgentResultCardProps {
  result: AggregatedResult;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const SectionRow: React.FC<{ section: AggregatedSection }> = ({ section }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-zinc-700/50 rounded-lg bg-zinc-900/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground shrink-0" />
        )}
        <Bot size={12} className="text-indigo-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-secondary">{section.nickname}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/50 text-muted-foreground">
              {section.role}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{section.summary}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {section.success ? (
            <CheckCircle2 size={12} className="text-green-400" />
          ) : (
            <XCircle size={12} className="text-red-400" />
          )}
          {section.duration > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {formatDuration(section.duration)}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-2 border-t border-zinc-700/50 bg-black/30">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">
            Full Output
          </div>
          <pre className="text-xs text-secondary font-mono whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
            {section.fullOutput || '(empty)'}
          </pre>
          {section.errors.length > 0 && (
            <>
              <div className="text-[10px] text-red-400 mt-2 mb-1 uppercase tracking-wider">
                Errors
              </div>
              <ul className="text-xs text-red-300 space-y-1">
                {section.errors.map((err, i) => (
                  <li key={i} className="font-mono">
                    {err}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const SubAgentResultCard: React.FC<SubAgentResultCardProps> = ({ result }) => {
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);

  const isSuccess = result.failureCount === 0;

  return (
    <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 overflow-hidden my-3">
      {/* Header */}
      <div
        className={`px-4 py-3 border-b border-zinc-700/50 ${
          isSuccess ? 'bg-indigo-950/30' : 'bg-amber-950/20'
        }`}
      >
        <div className="flex items-center gap-2">
          <Users size={14} className={isSuccess ? 'text-indigo-400' : 'text-amber-400'} />
          <span className="text-sm font-semibold text-secondary">
            Multi-Agent Orchestration
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-400" />
              {result.successCount}
            </span>
            {result.failureCount > 0 && (
              <span className="flex items-center gap-1">
                <XCircle size={12} className="text-red-400" />
                {result.failureCount}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {formatDuration(result.totalDuration)}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">{result.summary}</p>
      </div>

      {/* Sections */}
      <div className="p-3 space-y-2">
        {result.sections.map((section, i) => (
          <SectionRow key={`${section.role}-${i}`} section={section} />
        ))}
      </div>

      {/* Artifacts */}
      {result.artifacts.length > 0 && (
        <div className="border-t border-zinc-700/50">
          <button
            onClick={() => setArtifactsExpanded(!artifactsExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-zinc-800/30 transition-colors"
          >
            {artifactsExpanded ? (
              <ChevronDown size={12} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={12} className="text-muted-foreground" />
            )}
            <FileText size={12} className="text-muted-foreground" />
            <span className="text-xs font-medium text-secondary">
              Artifacts ({result.artifacts.length})
            </span>
          </button>
          {artifactsExpanded && (
            <div className="px-4 pb-3 space-y-1">
              {result.artifacts.map((artifact) => (
                <div
                  key={artifact.key}
                  className="text-xs font-mono bg-zinc-800/40 rounded px-2 py-1"
                >
                  <span className="text-indigo-300">{artifact.key}</span>
                  <span className="text-muted-foreground">
                    {' '}— {artifact.contributors.join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="border-t border-zinc-700/50 px-4 py-3 bg-red-950/20">
          <div className="text-xs font-medium text-red-400 mb-1">Errors</div>
          <ul className="text-xs text-red-300 space-y-0.5 font-mono">
            {result.errors.map((err, i) => (
              <li key={i}>• {err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
