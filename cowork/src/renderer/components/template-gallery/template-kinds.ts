export type TemplateKind =
  | 'web-app'
  | 'landing'
  | 'dashboard'
  | 'slide-deck'
  | 'sheet'
  | 'doc'
  | 'report'
  | 'api'
  | 'mobile'
  | 'image';

export interface TemplateGalleryItem {
  id: string;
  kind: TemplateKind;
  name: string;
  tagline: string;
  accent?: string;
}

export const DEFAULT_TEMPLATES: TemplateGalleryItem[] = [
  { id: 'web-app', kind: 'web-app', name: 'Application web', tagline: 'Une interface complète avec navigation, panneaux et zones de travail.', accent: '#6366f1' },
  { id: 'landing', kind: 'landing', name: 'Landing page', tagline: 'Une page marketing avec hero, preuves et appels à l’action.', accent: '#14b8a6' },
  { id: 'dashboard', kind: 'dashboard', name: 'Dashboard', tagline: 'Des indicateurs, graphiques et cartes pour piloter une activité.', accent: '#f59e0b' },
  { id: 'slide-deck', kind: 'slide-deck', name: 'Présentation', tagline: 'Un deck structuré avec titres, puces et rythme narratif.', accent: '#8b5cf6' },
  { id: 'sheet', kind: 'sheet', name: 'Tableur', tagline: 'Une grille prête à organiser chiffres, listes et calculs.', accent: '#22c55e' },
  { id: 'doc', kind: 'doc', name: 'Document', tagline: 'Un texte clair avec titres, paragraphes et structure éditoriale.', accent: '#0ea5e9' },
  { id: 'report', kind: 'report', name: 'Rapport', tagline: 'Une synthèse visuelle façon magazine, lisible en un coup d’œil.', accent: '#ef4444' },
  { id: 'api', kind: 'api', name: 'API', tagline: 'Un contrat technique avec endpoints, statuts et méthodes.', accent: '#06b6d4' },
  { id: 'mobile', kind: 'mobile', name: 'Mobile', tagline: 'Un écran compact pensé pour le geste et les parcours rapides.', accent: '#ec4899' },
  { id: 'image', kind: 'image', name: 'Image', tagline: 'Une composition visuelle avec cadre, sujet et ambiance.', accent: '#84cc16' },
];

export function filterTemplates<T extends TemplateGalleryItem>(items: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('fr-FR');

  if (!normalizedQuery) {
    return [...items];
  }

  return items.filter((item) => {
    const searchable = `${item.name} ${item.tagline} ${item.kind}`.toLocaleLowerCase('fr-FR');
    return searchable.includes(normalizedQuery);
  });
}
