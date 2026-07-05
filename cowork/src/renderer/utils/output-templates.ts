/**
 * Pure output template catalog for pre-launch selection.
 *
 * @module renderer/utils/output-templates
 */

export interface OutputTemplate {
  id: 'report' | 'deck' | 'table' | 'page' | 'podcast';
  label: string;
  icon: string;
  mappedTool: string;
}

export const OUTPUT_TEMPLATES: OutputTemplate[] = [
  { id: 'report', label: 'Rapport', icon: 'file-text', mappedTool: 'deep_research' },
  { id: 'deck', label: 'Deck', icon: 'presentation', mappedTool: 'pptx_skill' },
  { id: 'table', label: 'Tableau', icon: 'table', mappedTool: 'xlsx_skill' },
  { id: 'page', label: 'Page', icon: 'globe', mappedTool: 'sparkpage' },
  { id: 'podcast', label: 'Podcast', icon: 'radio', mappedTool: 'piper_tts' },
];

export function templateById(id: string): OutputTemplate | undefined {
  return OUTPUT_TEMPLATES.find((template) => template.id === id);
}
