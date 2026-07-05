/**
 * Pure helpers for text-to-short-video storyboards.
 *
 * @module renderer/utils/storyboard-model
 */

export interface Scene {
  id: string;
  title: string;
  visual: string;
  voiceover: string;
  durationSec: number;
}

function splitIdeas(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function draftStoryboard(text: string): Scene[] {
  const ideas = splitIdeas(text);
  const source = ideas.length > 0 ? ideas : ['Présenter le sujet', 'Montrer la preuve', 'Conclure avec l’action'];

  return source.map((idea, index) => ({
    id: `scene-${index + 1}`,
    title: index === 0 ? 'Hook' : index === source.length - 1 ? 'Conclusion' : `Scène ${index + 1}`,
    visual: `Plan court illustrant : ${idea}`,
    voiceover: idea,
    durationSec: index === 0 ? 4 : 6,
  }));
}

export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((total, scene) => total + Math.max(0, scene.durationSec), 0);
}
