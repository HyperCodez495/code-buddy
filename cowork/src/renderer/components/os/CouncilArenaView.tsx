import { Crown, MessagesSquare } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import { StatTile } from '../ui/StatTile.js';
import { scoreSpread, shouldQuoteMinority, winnerOf, type CouncilSession } from './util/council-model.js';

export interface CouncilArenaViewProps {
  session: CouncilSession;
}

function stanceTone(stance: string) {
  if (stance === 'approve') {
    return 'success' as const;
  }
  if (stance === 'reject') {
    return 'danger' as const;
  }
  return 'warning' as const;
}

export function CouncilArenaView({ session }: CouncilArenaViewProps) {
  const spread = scoreSpread(session.verdicts);
  const winner = winnerOf(session.verdicts);
  const minority = shouldQuoteMinority(spread)
    ? [...session.verdicts].sort((left, right) => left.score - right.score).find((verdict) => verdict.citation)
    : undefined;

  if (session.verdicts.length === 0) {
    return <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="Council silencieux" hint="Aucune délibération n'est injectée pour cette session." />;
  }

  return (
    <SectionCard title={session.title} description="Arène de délibération : verdicts, gagnant, divergence et DHI.">
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile label="DHI" value={Math.round(session.dhi * 100)} hint="indice santé" tone={session.dhi > 0.75 ? 'success' : session.dhi > 0.5 ? 'warning' : 'danger'} />
        <StatTile label="Spread" value={spread.toFixed(2)} hint="écart score" tone={spread > 0.3 ? 'warning' : 'success'} />
        <StatTile label="Gagnant" value={winner?.model ?? '—'} hint={winner?.label} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {session.verdicts.map((verdict) => (
          <article key={verdict.agentId} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div><h3 className="font-semibold text-foreground">{verdict.label}</h3><p className="text-xs text-muted-foreground">{verdict.model}</p></div>
              <Pill tone={stanceTone(verdict.stance)}>{verdict.stance}</Pill>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: String(Math.max(0, Math.min(1, verdict.score)) * 100) + '%' }} /></div>
            <div className="mt-2 text-right text-xs tabular-nums text-muted-foreground">{verdict.score.toFixed(2)}</div>
            {winner?.agentId === verdict.agentId && <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"><Crown className="h-3 w-3" /> gagnant</div>}
          </article>
        ))}
      </div>
      {minority && <blockquote className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground">Citation minoritaire : “{minority.citation}”</blockquote>}
    </SectionCard>
  );
}
