import { describe, expect, it } from 'vitest';

import { buildVideoResearchCard } from '../../../src/tools/video/video-research-card.js';

describe('buildVideoResearchCard', () => {
  it('maps technology and verification signals across the complete transcript', () => {
    const card = buildVideoResearchCard({
      source: 'https://youtu.be/research123?si=tracking',
      method: 'youtube-captions',
      transcriptPath: '/tmp/transcript.txt',
      question: 'Quelles pistes sont utiles pour Code Buddy ?',
      segments: [
        { t_start: 0, t_end: 8, said: 'Introduction générale de la vidéo.' },
        { t_start: 120, t_end: 128, said: 'Le modèle PanoWorld conserve une mémoire spatiale cohérente.' },
        { t_start: 300, t_end: 309, said: 'Le projet est open source et disponible sur GitHub.' },
        { t_start: 600, t_end: 610, said: 'Le benchmark annonce 92,4 % sur un seul GPU.' },
        { t_start: 900, t_end: 910, said: 'Un robot exécute ensuite les commandes vocales en temps réel.' },
      ],
    });

    expect(card).toContain('# Fiche de recherche vidéo');
    expect(card).toContain('Quelles pistes sont utiles pour Code Buddy ?');
    expect(card).toContain('PanoWorld');
    expect(card).toContain('GitHub');
    expect(card).toContain('92,4 %');
    expect(card).toContain('15:00');
    expect(card).toContain('ils ne constituent pas une validation');
  });

  it('deduplicates explicit links and includes an optional cloud synopsis', () => {
    const card = buildVideoResearchCard({
      source: 'https://example.com/video.mp4',
      method: 'direct-url',
      transcriptPath: '/tmp/transcript.txt',
      cloudAnswer: 'Synthèse horodatée du contenu visuel.',
      segments: [
        { t_start: 0, t_end: 5, said: 'Code sur https://github.com/example/repo.' },
        { t_start: 6, t_end: 10, said: 'Voir encore https://github.com/example/repo.' },
      ],
    });

    expect(card.match(/https:\/\/github\.com\/example\/repo/g)).toHaveLength(3);
    expect(card).toContain('Synthèse cloud disponible (non vérifiée)');
    expect(card).toContain('Synthèse horodatée du contenu visuel.');
  });

  it('remains useful for a silent or non-technical transcript', () => {
    const card = buildVideoResearchCard({
      source: '/videos/silent.mp4',
      method: 'local-file',
      transcriptPath: '/tmp/silent.txt',
      segments: [],
    });

    expect(card).toContain('0 segments');
    expect(card).toContain('Aucun passage détecté automatiquement');
    expect(card).toContain('Analyse générale de la vidéo partagée.');
  });
});
