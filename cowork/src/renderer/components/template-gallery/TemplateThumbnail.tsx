import type { CSSProperties, ReactNode } from 'react';
import type { TemplateKind } from './template-kinds.js';

export interface TemplateThumbnailProps {
  kind: TemplateKind;
  accent?: string;
}

const DEFAULT_ACCENT = 'var(--color-accent, hsl(var(--primary)))';

function SvgShell({ kind, accent, children }: { kind: TemplateKind; accent: string; children: ReactNode }) {
  return (
    <svg
      role="img"
      aria-label={`Mini-maquette ${kind}`}
      viewBox="0 0 320 200"
      className="h-full w-full rounded-xl bg-background"
      style={{ '--template-accent': accent } as CSSProperties}
    >
      <rect x="1" y="1" width="318" height="198" rx="18" className="fill-surface stroke-border" />
      {children}
    </svg>
  );
}

function Lines({ y, count, x = 36, width = 120 }: { y: number; count: number; x?: number; width?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <rect
      key={`${y}-${index}`}
      x={x}
      y={y + index * 15}
      width={Math.max(30, width - index * 16)}
      height="6"
      rx="3"
      className="fill-muted-foreground/25"
    />
  ));
}

function WebAppMockup() {
  return (
    <>
      <rect x="28" y="28" width="264" height="144" rx="12" className="fill-muted/40 stroke-border" />
      <rect x="28" y="28" width="264" height="22" rx="12" className="fill-muted" />
      <circle cx="45" cy="39" r="3" className="fill-red-500/70" />
      <circle cx="57" cy="39" r="3" className="fill-amber-500/70" />
      <circle cx="69" cy="39" r="3" className="fill-green-500/70" />
      <rect x="44" y="66" width="52" height="86" rx="8" className="fill-background stroke-border" />
      <rect x="112" y="66" width="142" height="28" rx="8" fill="var(--template-accent)" opacity="0.22" />
      <rect x="112" y="110" width="58" height="42" rx="8" className="fill-background stroke-border" />
      <rect x="188" y="110" width="66" height="42" rx="8" className="fill-background stroke-border" />
      <rect x="58" y="82" width="24" height="5" rx="2.5" fill="var(--template-accent)" />
      <Lines y={99} count={3} x={58} width={24} />
    </>
  );
}

function LandingMockup() {
  return (
    <>
      <rect x="42" y="34" width="236" height="66" rx="14" fill="var(--template-accent)" opacity="0.2" />
      <rect x="68" y="55" width="92" height="10" rx="5" fill="var(--template-accent)" />
      <rect x="68" y="73" width="64" height="7" rx="3.5" className="fill-muted-foreground/30" />
      <rect x="192" y="53" width="50" height="28" rx="14" className="fill-background stroke-border" />
      {[52, 124, 196].map((x) => (
        <rect key={x} x={x} y="122" width="56" height="44" rx="10" className="fill-background stroke-border" />
      ))}
    </>
  );
}

function DashboardMockup() {
  return (
    <>
      {[34, 126, 218].map((x, index) => (
        <rect key={x} x={x} y="32" width="68" height="44" rx="10" className="fill-background stroke-border" opacity={index === 1 ? 1 : 0.8} />
      ))}
      <rect x="34" y="96" width="128" height="70" rx="12" className="fill-background stroke-border" />
      <rect x="180" y="96" width="106" height="70" rx="12" className="fill-background stroke-border" />
      {[52, 70, 88, 106, 124].map((x, index) => (
        <rect key={x} x={x} y={144 - index * 9} width="12" height={18 + index * 9} rx="4" fill="var(--template-accent)" opacity={0.35 + index * 0.12} />
      ))}
      <circle cx="232" cy="132" r="22" fill="none" stroke="var(--template-accent)" strokeWidth="10" strokeDasharray="92 138" />
    </>
  );
}

function SlideDeckMockup() {
  return (
    <>
      <rect x="42" y="34" width="236" height="132" rx="14" className="fill-background stroke-border" />
      <rect x="68" y="58" width="112" height="12" rx="6" fill="var(--template-accent)" />
      {[88, 108, 128].map((y) => (
        <g key={y}>
          <circle cx="74" cy={y + 3} r="3" fill="var(--template-accent)" opacity="0.7" />
          <rect x="88" y={y} width="126" height="7" rx="3.5" className="fill-muted-foreground/30" />
        </g>
      ))}
      <rect x="218" y="146" width="34" height="7" rx="3.5" className="fill-muted-foreground/30" />
    </>
  );
}

function SheetMockup() {
  const columns = [44, 88, 132, 176, 220];
  const rows = [44, 70, 96, 122, 148];
  return (
    <>
      <rect x="36" y="34" width="248" height="134" rx="10" className="fill-background stroke-border" />
      <rect x="36" y="34" width="248" height="26" rx="10" fill="var(--template-accent)" opacity="0.18" />
      {columns.map((x) => <line key={x} x1={x} y1="34" x2={x} y2="168" className="stroke-border" />)}
      {rows.map((y) => <line key={y} x1="36" y1={y} x2="284" y2={y} className="stroke-border" />)}
      <rect x="190" y="104" width="54" height="9" rx="4.5" fill="var(--template-accent)" opacity="0.7" />
    </>
  );
}

function DocMockup() {
  return (
    <>
      <rect x="78" y="28" width="164" height="144" rx="10" className="fill-background stroke-border" />
      <rect x="102" y="54" width="76" height="10" rx="5" fill="var(--template-accent)" />
      <Lines y={82} count={6} x={102} width={112} />
    </>
  );
}

function ReportMockup() {
  return (
    <>
      <rect x="46" y="30" width="228" height="140" rx="12" className="fill-background stroke-border" />
      <rect x="66" y="54" width="82" height="12" rx="6" fill="var(--template-accent)" />
      <rect x="178" y="52" width="58" height="44" rx="8" fill="var(--template-accent)" opacity="0.18" />
      {[66, 132, 198].map((x) => <g key={x}><Lines y={110} count={4} x={x} width={46} /></g>)}
    </>
  );
}

function ApiMockup() {
  const endpoints = [
    ['GET', 54, 'fill-green-500/80'],
    ['POST', 84, 'fill-blue-500/80'],
    ['PATCH', 114, 'fill-amber-500/80'],
    ['DEL', 144, 'fill-red-500/80'],
  ] as const;
  return (
    <>
      <rect x="42" y="34" width="236" height="132" rx="12" className="fill-background stroke-border" />
      {endpoints.map(([method, y, color]) => (
        <g key={method}>
          <rect x="62" y={y} width="50" height="16" rx="8" className={color} />
          <text x="87" y={y + 11} textAnchor="middle" className="fill-white text-[8px] font-bold">{method}</text>
          <rect x="126" y={y + 4} width="110" height="8" rx="4" fill={method === 'POST' ? 'var(--template-accent)' : 'currentColor'} className="text-muted-foreground/25" />
        </g>
      ))}
    </>
  );
}

function MobileMockup() {
  return (
    <>
      <rect x="112" y="22" width="96" height="156" rx="24" className="fill-background stroke-border" />
      <rect x="144" y="34" width="32" height="5" rx="2.5" className="fill-muted-foreground/30" />
      <rect x="130" y="54" width="60" height="44" rx="14" fill="var(--template-accent)" opacity="0.22" />
      <rect x="130" y="114" width="60" height="10" rx="5" fill="var(--template-accent)" />
      <Lines y={138} count={2} x={132} width={56} />
    </>
  );
}

function ImageMockup() {
  return (
    <>
      <rect x="50" y="34" width="220" height="132" rx="14" className="fill-background stroke-border" />
      <circle cx="216" cy="72" r="18" fill="var(--template-accent)" opacity="0.28" />
      <path d="M70 142 L126 92 L166 124 L194 104 L250 142 Z" fill="var(--template-accent)" opacity="0.42" />
      <rect x="78" y="52" width="70" height="10" rx="5" className="fill-muted-foreground/30" />
    </>
  );
}

function renderKind(kind: TemplateKind): ReactNode {
  switch (kind) {
    case 'web-app': return <WebAppMockup />;
    case 'landing': return <LandingMockup />;
    case 'dashboard': return <DashboardMockup />;
    case 'slide-deck': return <SlideDeckMockup />;
    case 'sheet': return <SheetMockup />;
    case 'doc': return <DocMockup />;
    case 'report': return <ReportMockup />;
    case 'api': return <ApiMockup />;
    case 'mobile': return <MobileMockup />;
    case 'image': return <ImageMockup />;
  }
}

export function TemplateThumbnail({ kind, accent = DEFAULT_ACCENT }: TemplateThumbnailProps) {
  return <SvgShell kind={kind} accent={accent}>{renderKind(kind)}</SvgShell>;
}
