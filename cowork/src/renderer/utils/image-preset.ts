/**
 * Pure image-prompt presets for the Cowork image studio.
 *
 * @module renderer/utils/image-preset
 */

export interface ImagePreset {
  id: string;
  label: string;
  style: string;
  ratio: '1:1' | '4:3' | '16:9' | '9:16';
  promptSuffix: string;
  negativePrompt?: string;
}

export interface ImageResult {
  id: string;
  prompt: string;
  imageUrl?: string;
  status: 'queued' | 'rendering' | 'done' | 'failed';
}

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'product',
    label: 'Produit',
    style: 'photo studio',
    ratio: '4:3',
    promptSuffix: 'photo studio nette, éclairage doux, arrière-plan sobre, détails inspectables',
  },
  {
    id: 'editorial',
    label: 'Éditorial',
    style: 'editorial',
    ratio: '16:9',
    promptSuffix: 'composition éditoriale, sujet lisible, profondeur légère, rendu naturel',
  },
  {
    id: 'mobile',
    label: 'Vertical',
    style: 'social short',
    ratio: '9:16',
    promptSuffix: 'composition verticale, sujet centré, zones sûres pour texte mobile',
  },
  {
    id: 'icon',
    label: 'Icône',
    style: 'clean icon',
    ratio: '1:1',
    promptSuffix: 'icône simple, contraste élevé, silhouette claire, fond transparent',
  },
];

export function buildImagePrompt(base: string, preset: ImagePreset): string {
  const cleanBase = base.trim().replace(/\s+/g, ' ');
  const parts = [cleanBase, preset.promptSuffix, `style: ${preset.style}`, `ratio: ${preset.ratio}`].filter(Boolean);
  if (preset.negativePrompt) parts.push(`avoid: ${preset.negativePrompt}`);
  return parts.join(' · ');
}
