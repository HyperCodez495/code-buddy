import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  wireSensoryRules,
  saveSensoryRules,
  toggleSensoryRule,
  type SensoryRule,
} from '../../src/sensory/sensory-rules-engine.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-reload-${process.pid}-${n++}`);
  process.env.CODEBUDDY_SENSORY_RULES_FILE = path.join(dir, 'sensory-rules.json');
  process.env.CODEBUDDY_RULE_RUNS_FILE = path.join(dir, 'rule-runs.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_SENSORY_RULES_FILE;
  delete process.env.CODEBUDDY_RULE_RUNS_FILE;
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function fire(kind: string): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'x', kind, payload: {} },
  });
}

const rule: SensoryRule = {
  id: 'r1',
  enabled: true,
  match: { kind: 'test_kind' },
  action: { type: 'shell', command: 'echo hi' },
};

describe('sensory-rules — hot-reload (admin change takes effect with no restart)', () => {
  it('a rule disabled via the admin stops firing on the RUNNING engine', async () => {
    await saveSensoryRules([rule]);
    const execute = vi.fn(async () => ({ ok: true }));
    const unwire = wireSensoryRules({ reloadThrottleMs: 0, execute, now: () => 1_000_000 });
    try {
      await tick(); // initial load completes

      fire('test_kind');
      await tick();
      expect(execute).toHaveBeenCalledTimes(1); // rule fired

      // Admin disables the rule (writes the JSON; new mtime).
      await tick(10);
      expect(await toggleSensoryRule('r1', false)).toBe(true);

      // One event triggers the throttled reload (may still fire on old rules); let it settle.
      fire('test_kind');
      await tick();
      execute.mockClear();

      // Now the running engine has the disabled rule → no more fires. NO restart happened.
      fire('test_kind');
      await tick();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      unwire();
    }
  });
});
