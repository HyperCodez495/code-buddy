export type MissionSlot = 'header' | 'left' | 'main' | 'right';

export interface MissionControlPresence {
  header?: boolean;
  left?: boolean;
  main?: boolean;
  right?: boolean;
}

export interface MissionControlLayoutSummary {
  activeSlots: MissionSlot[];
  hasSidebars: boolean;
  columnClass: string;
}

const SLOT_ORDER: MissionSlot[] = ['header', 'left', 'main', 'right'];

export function summarizeMissionLayout(presence: MissionControlPresence): MissionControlLayoutSummary {
  const activeSlots = SLOT_ORDER.filter((slot) => presence[slot]);
  const hasSidebars = Boolean(presence.left || presence.right);

  return {
    activeSlots,
    hasSidebars,
    columnClass: hasSidebars ? 'lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(14rem,18rem)]' : 'lg:grid-cols-1',
  };
}

export function describeMissionLayout(presence: MissionControlPresence): string {
  const summary = summarizeMissionLayout(presence);
  if (summary.activeSlots.length === 0) return 'Cadre vide';
  return summary.activeSlots.join(' + ');
}
