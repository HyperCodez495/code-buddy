import { describe, expect, it } from 'vitest';
import { __test as engine, type SensoryRule } from '../../src/sensory/sensory-rules-engine';
import { __test as exec, executeSensoryAction } from '../../src/sensory/sensory-action-executor';

const rule = (over: Partial<SensoryRule> = {}): SensoryRule => ({
  id: 'r1',
  match: { kind: 'person_entered' },
  action: { type: 'alert' },
  ...over,
});

describe('ruleMatches', () => {
  const now = new Date('2026-06-25T14:00:00');

  it('matches on kind', () => {
    expect(engine.ruleMatches(rule(), { modality: 'vision', kind: 'person_entered' }, now)).toBe(true);
    expect(engine.ruleMatches(rule(), { modality: 'vision', kind: 'drowsy' }, now)).toBe(false);
  });

  it('honors enabled:false and modality', () => {
    expect(engine.ruleMatches(rule({ enabled: false }), { kind: 'person_entered' }, now)).toBe(false);
    expect(engine.ruleMatches(rule({ match: { kind: 'person_entered', modality: 'audio' } }), { modality: 'vision', kind: 'person_entered' }, now)).toBe(false);
  });

  it('matches payload filters', () => {
    const r = rule({ match: { kind: 'person_entered', filters: { camera: 'brio' } } });
    expect(engine.ruleMatches(r, { kind: 'person_entered', payload: { camera: 'brio' } }, now)).toBe(true);
    expect(engine.ruleMatches(r, { kind: 'person_entered', payload: { camera: 'garage' } }, now)).toBe(false);
  });
});

describe('withinWindow (time-of-day)', () => {
  it('plain window', () => {
    expect(engine.withinWindow(new Date('2026-06-25T10:00:00'), ['08:00', '18:00'])).toBe(true);
    expect(engine.withinWindow(new Date('2026-06-25T20:00:00'), ['08:00', '18:00'])).toBe(false);
  });
  it('wraps past midnight (22:00→06:00)', () => {
    expect(engine.withinWindow(new Date('2026-06-25T23:30:00'), ['22:00', '06:00'])).toBe(true);
    expect(engine.withinWindow(new Date('2026-06-25T03:00:00'), ['22:00', '06:00'])).toBe(true);
    expect(engine.withinWindow(new Date('2026-06-25T12:00:00'), ['22:00', '06:00'])).toBe(false);
  });
  it('no window = always', () => {
    expect(engine.withinWindow(new Date(), undefined)).toBe(true);
  });
});

describe('shell action safety', () => {
  it('blocks destructive commands (even a user rule)', () => {
    expect(exec.isDestructive('rm -rf /home/x')).toBe(true);
    expect(exec.isDestructive('sudo reboot')).toBe(true);
    expect(exec.isDestructive('dd if=/dev/zero of=/dev/sda')).toBe(true);
    expect(exec.isDestructive('echo hello >> ~/log.txt')).toBe(false);
  });

  it('a refused destructive shell action returns ok:false and runs nothing', async () => {
    const res = await executeSensoryAction({ type: 'shell', command: 'rm -rf ~/important' }, { kind: 'person_entered' });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/blocked/);
  });

  it('INJECTION-SAFE: event description with "; rm" never executes — it is env, not command', async () => {
    const env = exec.actionEnv({ kind: 'person_entered', description: '; rm -rf ~ #' });
    // The malicious text lives only in an env var, never spliced into a command string.
    expect(env.VISION_DESC).toBe('; rm -rf ~ #');
    // A benign command that *reads* the env is safe — the text is data, not code.
    const res = await executeSensoryAction(
      { type: 'shell', command: 'printf "%s" "$VISION_DESC"' },
      { kind: 'person_entered', description: '; rm -rf ~ #' },
    );
    expect(res.ok).toBe(true);
    expect(res.detail).toBe('; rm -rf ~ #'); // echoed verbatim, NOT executed
  });
});
