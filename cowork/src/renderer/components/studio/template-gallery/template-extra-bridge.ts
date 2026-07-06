/**
 * template-extra-bridge — adapts the vague-Codex-E catalogue (rich prompts +
 * inline mockups) onto the EXISTING gallery item shape (TemplateGalleryItem,
 * whose visuals are drawn per `kind`). The wave's real value is the detailed
 * generation prompts: `extraPromptById` lets the selection seed the composer
 * with the full prompt instead of a name+tagline stub.
 */
import type { TemplateGalleryItem, TemplateKind } from '../../template-gallery/template-kinds';
import { EXTRA_TEMPLATES } from './template-catalog-extra';

const KIND_BY_ID: Record<string, TemplateKind> = {
  'extra-creative-portfolio': 'web-app',
  'extra-personal-blog': 'doc',
  'extra-saas-landing': 'landing',
  'extra-analytics-dashboard': 'dashboard',
  'extra-interactive-quiz': 'web-app',
  'extra-ecommerce-showcase': 'landing',
  'extra-documentation-site': 'doc',
  'extra-memory-game': 'web-app',
};

const ACCENT_BY_KIND: Record<TemplateKind, string> = {
  'web-app': '#8b5cf6',
  landing: '#14b8a6',
  dashboard: '#f59e0b',
  'slide-deck': '#8b5cf6',
  sheet: '#22c55e',
  doc: '#0ea5e9',
  report: '#ef4444',
  api: '#06b6d4',
  mobile: '#ec4899',
  image: '#eab308',
};

export const EXTRA_GALLERY_ITEMS: TemplateGalleryItem[] = EXTRA_TEMPLATES.map((template) => {
  const kind = KIND_BY_ID[template.id] ?? 'web-app';
  return { id: template.id, kind, name: template.name, tagline: template.tagline, accent: ACCENT_BY_KIND[kind] };
});

/** Full generation prompt for an extra template id (undefined for built-ins). */
export const extraPromptById = new Map(EXTRA_TEMPLATES.map((template) => [template.id, template.prompt]));
