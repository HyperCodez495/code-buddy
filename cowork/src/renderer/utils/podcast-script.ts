/**
 * Pure helpers for narrated podcast scripts.
 *
 * @module renderer/utils/podcast-script
 */

export interface PodSegment {
  id: string;
  title: string;
  voice: string;
  script: string;
}

function topicLabel(topic: string): string {
  const cleaned = topic.trim().replace(/\s+/g, ' ');
  return cleaned || 'Sujet à définir';
}

export function draftPodcastScript(topic: string): PodSegment[] {
  const label = topicLabel(topic);
  return [
    {
      id: 'intro',
      title: 'Introduction',
      voice: 'Piper narrateur',
      script: `Bienvenue. Aujourd’hui, on explique ${label} en gardant les points utiles pour décider vite.`,
    },
    {
      id: 'context',
      title: 'Contexte',
      voice: 'Piper narrateur',
      script: 'On commence par le contexte, les enjeux, et les contraintes qui changent vraiment le résultat.',
    },
    {
      id: 'analysis',
      title: 'Analyse',
      voice: 'Piper narrateur',
      script: 'Ensuite, on compare les options, les risques, et les signaux qui méritent confiance.',
    },
    {
      id: 'close',
      title: 'Conclusion',
      voice: 'Piper narrateur',
      script: 'Pour finir, on résume les actions à lancer et les décisions à confirmer.',
    },
  ];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateAudioLength(segments: PodSegment[]): number {
  const words = segments.reduce((total, segment) => total + wordCount(segment.script), 0);
  if (words === 0) return 0;
  return Math.ceil(words / 2.5);
}
