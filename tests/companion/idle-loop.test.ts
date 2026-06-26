import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runIdleTick, resetIdleState, IDLE_ACT_ALLOWLIST, type IdleDeps, type IdleTask } from '../../src/companion/idle-loop.js';

const DAY = new Date('2026-06-26T14:00:00');
const NIGHT = new Date('2026-06-26T23:30:00');

function deps(over: Partial<IdleDeps> = {}): IdleDeps {
  return {
    now: () => DAY,
    isAlone: () => true,
    recentSummaries: async () => ['a vu du monde', 'a entendu parler de tests'],
    repoStatus: async () => ['## main...origin/main', ' M src/x.ts'],
    reminders: async () => ['09:00 — médicaments'],
    record: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  resetIdleState();
  process.env.CODEBUDDY_COMPANION_IDLE = 'true';
});
afterEach(() => {
  delete process.env.CODEBUDDY_COMPANION_IDLE;
});

describe('idle loop — only acts when truly alone, and only safe things', () => {
  it('does nothing when not opted in', async () => {
    delete process.env.CODEBUDDY_COMPANION_IDLE;
    const record = vi.fn(async () => {});
    expect(await runIdleTick(deps({ record }))).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('does nothing when someone is present (only works alone)', async () => {
    const record = vi.fn(async () => {});
    expect(await runIdleTick(deps({ record, isAlone: () => false }))).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('does nothing at night (quiet hours)', async () => {
    const record = vi.fn(async () => {});
    expect(await runIdleTick(deps({ record, now: () => NIGHT }))).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('produces a read-only status / journal artifact when alone', async () => {
    const record = vi.fn(async () => {});
    const art = await runIdleTick(deps({ record }));
    expect(art).toBeTruthy();
    expect(['journal', 'status', 'brief']).toContain(art!.kind);
    expect(record).toHaveBeenCalledTimes(1);
    // every default act is on the closed allowlist
    if (art!.acted) expect(IDLE_ACT_ALLOWLIST).toContain(art!.acted);
  });

  it('SAFETY: a task that claims a non-allowlisted act is downgraded to a suggestion — never acts', async () => {
    const record = vi.fn(async () => {});
    const rogue: IdleTask = {
      id: 'rogue',
      cadenceMs: 0,
      run: () => ({ kind: 'status', title: 'fix it', body: 'I will git push', acted: 'git-push' as never }),
    };
    const art = await runIdleTick(deps({ record, tasks: [rogue] }));
    expect(art).toBeTruthy();
    expect(art!.acted).toBeUndefined(); // the unlisted act was stripped
    expect(art!.kind).toBe('suggestion'); // recorded as a reviewable suggestion, not an action
    const recorded = (record as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(recorded.acted).toBeUndefined();
  });

  it('enforces the hourly cap', async () => {
    let t = DAY.getTime();
    const one: IdleTask = { id: 'one', cadenceMs: 0, run: () => ({ kind: 'journal', title: 't', body: 'b', acted: 'journal-memory' }) };
    const d = deps({ tasks: [one], hourlyCap: 1, now: () => new Date(t) });
    expect(await runIdleTick(d)).toBeTruthy();
    t += 1000;
    expect(await runIdleTick(d)).toBeNull(); // cap reached
  });

  it('never throws (a task that explodes → nothing)', async () => {
    const boom: IdleTask = { id: 'boom', cadenceMs: 0, run: () => { throw new Error('nope'); } };
    await expect(runIdleTick(deps({ tasks: [boom] }))).resolves.toBeNull();
  });
});
