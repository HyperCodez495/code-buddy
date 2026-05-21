import { describe, expect, it } from 'vitest';

import { HOOK_EVENTS } from '../src/main/hooks/hooks-bridge';

describe('HooksBridge event catalog', () => {
  it('includes Hermes lifecycle hook events for Cowork configuration', () => {
    expect(HOOK_EVENTS).toEqual(
      expect.arrayContaining([
        'BeforeMemoryWrite',
        'AfterRunComplete',
        'BeforeScheduledDelivery',
      ]),
    );
  });
});
