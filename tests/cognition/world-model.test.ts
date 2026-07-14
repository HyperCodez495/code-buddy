import { describe, expect, it } from 'vitest';
import { WorldModel, type WorldObservation } from '../../src/cognition/world-model.js';

function observation(overrides: Partial<WorldObservation> = {}): WorldObservation {
  return {
    eventId: 'event-1',
    entityId: 'person-1',
    entityType: 'person',
    visibility: 'visible',
    observedAt: 1_000,
    receivedAt: 1_010,
    confidence: 0.9,
    source: 'camera',
    kind: 'person_entered',
    ttlMs: 500,
    ...overrides,
  };
}

describe('WorldModel', () => {
  it('tracks first/last seen, confidence, attributes and bounded provenance', () => {
    const model = new WorldModel();
    expect(model.observe(observation()).applied).toBe(true);
    model.observe(
      observation({
        eventId: 'event-2',
        observedAt: 1_100,
        receivedAt: 1_110,
        kind: 'drowsy',
        attributes: { drowsy: true },
      }),
    );
    expect(model.get('person-1')).toMatchObject({
      visibility: 'visible',
      firstSeen: 1_000,
      lastSeen: 1_100,
      lastObservedAt: 1_100,
      confidence: 0.9,
      attributes: { drowsy: true },
    });
    expect(model.get('person-1')?.provenance).toHaveLength(2);
  });

  it('is idempotent and does not let an out-of-order observation regress state', () => {
    const model = new WorldModel();
    model.observe(observation({ eventId: 'new', observedAt: 2_000 }));
    expect(model.observe(observation({ eventId: 'new', observedAt: 2_000 }))).toEqual({
      applied: false,
      reason: 'duplicate',
    });
    expect(
      model.observe(
        observation({
          eventId: 'late-old-frame',
          visibility: 'absent',
          observedAt: 1_500,
          receivedAt: 2_100,
          kind: 'person_left',
        }),
      ),
    ).toEqual({ applied: false, reason: 'stale' });
    expect(model.get('person-1')).toMatchObject({ visibility: 'visible', lastSeen: 2_000 });
  });

  it('turns expired visibility into unknown rather than inventing absence', () => {
    const model = new WorldModel();
    model.observe(observation());
    expect(model.expire(1_509)).toEqual([]);
    const expired = model.expire(1_510);
    expect(expired).toHaveLength(1);
    expect(model.get('person-1')).toMatchObject({
      visibility: 'unknown',
      confidence: 0,
      expiresAt: null,
      lastSeen: 1_000,
    });
  });

  it('accepts a direct absent transition but expires that claim too', () => {
    const model = new WorldModel();
    model.observe(observation());
    model.observe(
      observation({
        eventId: 'left',
        visibility: 'absent',
        observedAt: 1_200,
        receivedAt: 1_210,
        kind: 'person_left',
        ttlMs: 100,
      }),
    );
    expect(model.get('person-1')?.visibility).toBe('absent');
    model.expire(1_310);
    expect(model.get('person-1')?.visibility).toBe('unknown');
  });

  it('resolves equal timestamps deterministically in favour of explicit absence', () => {
    const forward = new WorldModel();
    forward.observe(observation({ eventId: 'visible', observedAt: 2_000, receivedAt: 2_000 }));
    forward.observe(
      observation({
        eventId: 'absent',
        visibility: 'absent',
        kind: 'person_left',
        observedAt: 2_000,
        receivedAt: 2_001,
      }),
    );
    const reversed = new WorldModel();
    reversed.observe(
      observation({
        eventId: 'absent',
        visibility: 'absent',
        kind: 'person_left',
        observedAt: 2_000,
        receivedAt: 2_001,
      }),
    );
    reversed.observe(observation({ eventId: 'visible', observedAt: 2_000, receivedAt: 2_002 }));
    expect(forward.get('person-1')).toMatchObject({ visibility: 'absent', firstSeen: 2_000 });
    expect(reversed.get('person-1')).toMatchObject({ visibility: 'absent', firstSeen: 2_000 });
  });

  it('rejects implausibly old or future timestamps before they poison the cursor', () => {
    const model = new WorldModel({ maxFutureSkewMs: 100, maxObservationAgeMs: 1_000 });
    expect(
      model.observe(observation({ eventId: 'future', observedAt: 5_000, receivedAt: 1_000 })),
    ).toEqual({ applied: false, reason: 'invalid' });
    expect(
      model.observe(observation({ eventId: 'old', observedAt: 1_000, receivedAt: 5_000 })),
    ).toEqual({ applied: false, reason: 'invalid' });
    expect(model.observe(observation({ eventId: 'valid' })).applied).toBe(true);
  });

  it('can restore visibility with a newer observation after expiry', () => {
    const model = new WorldModel();
    model.observe(observation());
    model.expire(1_510);
    expect(model.get('person-1')?.visibility).toBe('unknown');
    model.observe(
      observation({ eventId: 'returned', observedAt: 1_600, receivedAt: 1_610 }),
    );
    expect(model.get('person-1')).toMatchObject({
      visibility: 'visible',
      firstSeen: 1_000,
      lastSeen: 1_600,
    });
  });

  it('keeps entity and replay memory bounded', () => {
    const model = new WorldModel({ capacity: 2, eventCapacity: 2 });
    model.observe(observation({ eventId: 'a', entityId: 'a', receivedAt: 1 }));
    model.observe(observation({ eventId: 'b', entityId: 'b', receivedAt: 2 }));
    model.expire(10_000);
    model.observe(observation({ eventId: 'c', entityId: 'c', receivedAt: 3 }));
    expect(model.snapshot()).toHaveLength(2);
    expect(model.get('a')).toBeUndefined();
  });
});
