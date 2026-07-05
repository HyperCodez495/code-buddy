/**
 * Pure helpers for AI slide deck outlines.
 *
 * @module renderer/utils/slide-outline
 */

export interface SlideOutline {
  id: string;
  title: string;
  bullets: string[];
}

function cleanPrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

function titleFromPrompt(prompt: string): string {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return 'Deck sans titre';
  return cleaned.length > 72 ? `${cleaned.slice(0, 69).trim()}...` : cleaned;
}

export function draftOutline(prompt: string): SlideOutline[] {
  const topic = titleFromPrompt(prompt);
  return [
    {
      id: 'title',
      title: topic,
      bullets: ['Objectif du deck', 'Audience visée', 'Résultat attendu'],
    },
    {
      id: 'context',
      title: 'Contexte',
      bullets: ['Situation actuelle', 'Contraintes clés', 'Signal de marché ou d’usage'],
    },
    {
      id: 'proposal',
      title: 'Proposition',
      bullets: ['Approche recommandée', 'Capacités mobilisées', 'Plan d’exécution'],
    },
    {
      id: 'proof',
      title: 'Preuves et risques',
      bullets: ['Indicateurs de confiance', 'Risques à surveiller', 'Garde-fous'],
    },
    {
      id: 'next',
      title: 'Prochaines étapes',
      bullets: ['Décisions requises', 'Responsables', 'Échéance'],
    },
  ];
}

export function outlineToSpeakerNotes(outline: SlideOutline[]): string {
  return outline
    .map((slide, index) => {
      const bullets = slide.bullets.map((bullet) => `- ${bullet}`).join('\n');
      return `Slide ${index + 1}: ${slide.title}\n${bullets}`;
    })
    .join('\n\n');
}
