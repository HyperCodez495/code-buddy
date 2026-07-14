import type {
  CompanionNumericStats,
  CompanionVoiceLoopStats,
} from '../../types';

interface CompanionVoiceMetricsProps {
  voice: CompanionVoiceLoopStats;
}

function latencyLabel(stats: CompanionNumericStats | undefined): string {
  if (!stats) return 'Pas encore mesuré';
  return `p50 ${Math.round(stats.p50)} ms · p95 ${Math.round(stats.p95)} ms`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background/45 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-xs font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

export function CompanionVoiceMetrics({ voice }: CompanionVoiceMetricsProps) {
  const latest = voice.latest;
  const latestTurn = latest?.turnTakingKind
    ? `${latest.turnTakingKind}${latest.resumeAfterPlaybackMs !== undefined
      ? ` · ${Math.round(latest.resumeAfterPlaybackMs)} ms`
      : ''}`
    : 'Pas encore mesuré';

  return (
    <div
      className="rounded-lg border border-border bg-surface/25 p-3"
      data-testid="companion-voice-metrics"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-text-primary">Conversation vocale</p>
          <p className="text-[10px] text-text-muted">
            {voice.hearingCount} tours analysés sur une fenêtre de {voice.windowSize}
          </p>
        </div>
        <span className="rounded bg-accent/10 px-2 py-1 text-[10px] text-accent">
          sans verbatim agrégé
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Premier son perçu"
          value={latencyLabel(voice.latency.perceivedResponseMs)}
        />
        <Metric
          label="Reprise humaine"
          value={latencyLabel(voice.latency.resumeAfterPlaybackMs)}
        />
        <Metric label="Dernier passage de parole" value={latestTurn} />
        <Metric
          label="Traîne / interruption / échos"
          value={`${voice.health.echoTailResumeCount ?? 0} / ${voice.health.playbackBargeInCount ?? 0} / ${voice.health.suppressedEchoCount ?? 0}`}
        />
      </div>
    </div>
  );
}
