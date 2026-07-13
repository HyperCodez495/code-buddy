import { describe, expect, it } from 'vitest';

import {
  MAX_SHARED_RELATIONSHIP_EVENTS,
  reduceSharedRelationshipState,
  renderSharedRelationshipContext,
  type SharedRelationshipEvent,
} from '../../src/conversation/shared-relationship-state.js';

function event(
  id: string,
  timestamp: string,
  origin: SharedRelationshipEvent['origin'],
  role: SharedRelationshipEvent['role'],
  content: string,
): SharedRelationshipEvent {
  return { id, timestamp, origin, role, content };
}

describe('shared relationship state', () => {
  it('derives the same raw-free snapshot independent of journal read order', () => {
    const events = [
      event(
        'voice-user',
        '2026-07-13T10:00:00.000Z',
        'voice',
        'user',
        'SECRET_SENTINEL je suis vraiment triste et mon dossier est projet-azur.',
      ),
      event(
        'voice-assistant',
        '2026-07-13T10:00:05.000Z',
        'voice',
        'assistant',
        'PRIVATE_REPLY_SENTINEL je reste présente.',
      ),
      event(
        'channel-user',
        '2026-07-13T10:01:00.000Z',
        'channel',
        'user',
        'On peut continuer ici.',
      ),
    ];
    const options = { now: Date.parse('2026-07-13T10:02:00.000Z') };

    const ordered = reduceSharedRelationshipState(events, options);
    const shuffled = reduceSharedRelationshipState([events[2]!, events[0]!, events[1]!], options);

    expect(shuffled).toEqual(ordered);
    expect(ordered).toMatchObject({
      windowSize: 3,
      counters: {
        total: 3,
        user: 2,
        assistant: 1,
        bySurface: { voice: 2, channel: 1, cowork: 0 },
        surfaceTransitions: 1,
      },
      surfacesSeen: ['channel', 'voice'],
      lastSurface: 'channel',
      lastRole: 'user',
      recency: 'immediate',
      affect: {
        kind: 'sadness',
        intensity: 'high',
        supportOpen: true,
      },
    });

    const serialized = JSON.stringify(ordered);
    expect(serialized).not.toContain('SECRET_SENTINEL');
    expect(serialized).not.toContain('PRIVATE_REPLY_SENTINEL');
    expect(serialized).not.toContain('projet-azur');
    expect(serialized).not.toMatch(/"(?:content|excerpt|topicTerms|hash|fingerprint|eventId)"/i);
  });

  it('expires affect at its TTL and lets an explicit recovery close support sooner', () => {
    const disclosed = event(
      'sad',
      '2026-07-13T10:00:00.000Z',
      'voice',
      'user',
      'Je suis triste.',
    );

    expect(
      reduceSharedRelationshipState([disclosed], {
        now: Date.parse('2026-07-13T10:00:00.999Z'),
        affectTtlMs: 1_000,
      }).affect,
    ).toMatchObject({ kind: 'sadness', supportOpen: true });
    expect(
      reduceSharedRelationshipState([disclosed], {
        now: Date.parse('2026-07-13T10:00:01.000Z'),
        affectTtlMs: 1_000,
      }).affect,
    ).toBeNull();

    const recovered = event(
      'better',
      '2026-07-13T10:00:00.500Z',
      'channel',
      'user',
      'Ça va mieux maintenant.',
    );
    expect(
      reduceSharedRelationshipState([disclosed, recovered], {
        now: Date.parse('2026-07-13T10:00:00.600Z'),
      }).affect,
    ).toBeNull();
  });

  it('replaces a support need with a later positive expression', () => {
    const snapshot = reduceSharedRelationshipState(
      [
        event('anxious', '2026-07-13T10:00:00.000Z', 'voice', 'user', 'Je suis très anxieux.'),
        event('joy', '2026-07-13T10:05:00.000Z', 'cowork', 'user', 'Génial, je suis trop content !'),
      ],
      { now: Date.parse('2026-07-13T10:05:10.000Z') },
    );

    expect(snapshot.affect).toMatchObject({ kind: 'joy', supportOpen: false });
  });

  it('keeps support open when a recovery phrase is contradicted by continuing distress', () => {
    for (const [content, kind] of [
      ['Ça va mieux, mais je suis encore très triste.', 'sadness'],
      ['Je vais mieux qu’hier, mais je suis toujours anxieux.', 'anxiety'],
      ['Tout va bien maintenant, sauf que je suis à bout.', 'frustration'],
    ] as const) {
      const snapshot = reduceSharedRelationshipState([
        event('mixed', '2026-07-13T10:00:00.000Z', 'voice', 'user', content),
      ]);
      expect(snapshot.affect, content).toMatchObject({ kind, supportOpen: true });
    }
  });

  it('keeps only a bounded event window and bounded counters', () => {
    const start = Date.parse('2026-07-13T08:00:00.000Z');
    const events = Array.from({ length: MAX_SHARED_RELATIONSHIP_EVENTS + 50 }, (_, index) =>
      event(
        `event-${String(index).padStart(3, '0')}`,
        new Date(start + index * 1_000).toISOString(),
        index % 2 === 0 ? 'voice' : 'channel',
        index % 2 === 0 ? 'user' : 'assistant',
        'Tour neutre.',
      ),
    );

    const snapshot = reduceSharedRelationshipState(events);
    expect(snapshot.windowSize).toBe(MAX_SHARED_RELATIONSHIP_EVENTS);
    expect(snapshot.counters.total).toBe(MAX_SHARED_RELATIONSHIP_EVENTS);
    expect(snapshot.counters.user + snapshot.counters.assistant).toBe(
      MAX_SHARED_RELATIONSHIP_EVENTS,
    );
  });

  it('retains only the status of a deliberation continued across surfaces', () => {
    const snapshot = reduceSharedRelationshipState([
      event(
        'question',
        '2026-07-13T10:00:00.000Z',
        'voice',
        'user',
        'Penses-tu que la liberté implique une responsabilité morale ?',
      ),
      event(
        'position',
        '2026-07-13T10:00:05.000Z',
        'channel',
        'assistant',
        'Oui, parce que choisir implique de pouvoir répondre de ses actes.',
      ),
      event(
        'challenge',
        '2026-07-13T10:00:10.000Z',
        'cowork',
        'user',
        "Je ne suis pas d'accord : et si nos choix sont déterminés ?",
      ),
    ]);

    expect(snapshot.deliberation).toMatchObject({
      active: true,
      phase: 'challenging',
      turnCount: 3,
      continuedAcrossSurfaces: true,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/libert|responsabil|determines/i);
  });

  it('renders fixed observations without reproducing raw dialogue or claiming an inner state', () => {
    const snapshot = reduceSharedRelationshipState(
      [
        event(
          'private',
          '2026-07-13T10:00:00.000Z',
          'voice',
          'user',
          'ULTRA_PRIVATE_SENTINEL je suis épuisé.',
        ),
        event(
          'handoff',
          '2026-07-13T10:00:05.000Z',
          'channel',
          'assistant',
          'Réponse privée qui ne doit pas ressortir.',
        ),
      ],
      { now: Date.parse('2026-07-13T10:00:06.000Z') },
    );

    const rendered = renderSharedRelationshipContext(snapshot);
    expect(rendered).toContain('observations, pas des sentiments subjectifs');
    expect(rendered).toContain('Soutien encore ouvert : oui');
    expect(rendered).toContain('messagerie, voix');
    expect(rendered).not.toContain('ULTRA_PRIVATE_SENTINEL');
    expect(rendered).not.toContain('Réponse privée');
    expect(rendered).not.toMatch(/detect|détect|classif|empreinte/i);
    expect(rendered.length).toBeLessThan(1_200);
  });

  it('renders nothing when there are no observations', () => {
    const snapshot = reduceSharedRelationshipState([
      event(
        'UNTRUSTED_ID_SENTINEL',
        'not-a-timestamp',
        'voice',
        'user',
        'UNTRUSTED_CONTENT_SENTINEL je suis triste.',
      ),
    ]);
    expect(snapshot.counters.total).toBe(0);
    expect(JSON.stringify(snapshot)).not.toContain('UNTRUSTED');
    expect(renderSharedRelationshipContext(snapshot)).toBe('');
  });
});
