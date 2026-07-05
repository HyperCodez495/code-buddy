import type { ReactNode } from 'react';
import { summarizeMissionLayout } from './mission-control-shell-model.js';

export interface MissionControlShellProps {
  header?: ReactNode;
  left?: ReactNode;
  main?: ReactNode;
  right?: ReactNode;
}

export function MissionControlShell({ header, left, main, right }: MissionControlShellProps) {
  const layout = summarizeMissionLayout({
    header: Boolean(header),
    left: Boolean(left),
    main: Boolean(main),
    right: Boolean(right),
  });

  return (
    <section className="min-h-full rounded-xl border border-border bg-background p-4 text-foreground">
      {header && <header className="mb-4 rounded-lg border border-border bg-surface p-4">{header}</header>}
      <div className={'grid gap-4 '+layout.columnClass}>
        <aside className={left ? 'min-w-0 space-y-4' : 'hidden lg:block'}>{left}</aside>
        <main className="min-w-0 space-y-4 overflow-x-auto">
          {main ?? (
            <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
              Aucune vue principale branchée.
            </div>
          )}
        </main>
        <aside className={right ? 'min-w-0 space-y-4' : 'hidden lg:block'}>{right}</aside>
      </div>
    </section>
  );
}
