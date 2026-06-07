/**
 * Mission Orchestrator — heartbeat + boot-recovery tests (Phase 1, §2.3/§2.4).
 *
 * Pure logic only: real temp-dir JSON store, deterministic injected clocks,
 * no Electron / IPC / timers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MissionStore } from '../src/main/missions/mission-store';
import { MissionManager } from '../src/main/missions/mission-manager';
import { MissionStatus } from '../src/main/missions/mission-types';
import {
  planBootRecovery,
  applyBootRecovery,
  INTERRUPTED_STATUSES,
} from '../src/main/missions/mission-recovery';
import {
  selectDueMissions,
  lastHeartbeatAt,
  isHeartbeatActive,
  MissionHeartbeat,
  HEARTBEAT_EVENT_TYPE,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from '../src/main/missions/mission-heartbeat';

/** Monotonic ISO clock (advances 1s per call) so timestamps are stable. */
function makeClock(startMs = Date.UTC(2026, 5, 7, 12, 0, 0)): () => string {
  let t = startMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}
function makeIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}
const iso = (ms: number) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 5, 7, 12, 0, 0);

let baseDir: string;
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-hb-'));
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function newManager(): MissionManager {
  const store = new MissionStore({ baseDir });
  return new MissionManager({ store, now: makeClock(), idFactory: makeIds() });
}

describe('boot recovery (§2.4)', () => {
  it('plans pausing only planning/running missions, leaving parked & terminal alone', async () => {
    const m = newManager();
    const running = await m.createMission({ title: 'running' });
    await m.updateStatus(running.id, MissionStatus.Running);
    const planning = await m.createMission({ title: 'planning' }); // stays Planning
    const paused = await m.createMission({ title: 'paused' });
    await m.updateStatus(paused.id, MissionStatus.Paused);
    const waiting = await m.createMission({ title: 'waiting' });
    await m.updateStatus(waiting.id, MissionStatus.WaitingApproval);
    const done = await m.createMission({ title: 'done' });
    await m.updateStatus(done.id, MissionStatus.Completed);

    const plan = planBootRecovery(m.listMissions());
    const ids = plan.items.map((i) => i.missionId).sort();
    expect(ids).toEqual([planning.id, running.id].sort());
    expect(plan.items.every((i) => i.toStatus === MissionStatus.Paused)).toBe(true);
    // INTERRUPTED set is exactly planning+running
    expect([...INTERRUPTED_STATUSES].sort()).toEqual(
      [MissionStatus.Planning, MissionStatus.Running].sort(),
    );
  });

  it('planBootRecovery is pure (does not mutate missions)', async () => {
    const m = newManager();
    const r = await m.createMission({ title: 'x' });
    await m.updateStatus(r.id, MissionStatus.Running);
    planBootRecovery(m.listMissions());
    expect(m.getMission(r.id)!.status).toBe(MissionStatus.Running);
  });

  it('applies recovery across a restart, idempotently, with an audit event', async () => {
    // Session 1: a running mission gets persisted.
    const store1 = new MissionStore({ baseDir });
    const m1 = new MissionManager({ store: store1, now: makeClock(), idFactory: makeIds() });
    const mission = await m1.createMission({ title: 'long job' });
    await m1.updateStatus(mission.id, MissionStatus.Running);

    // Session 2: fresh manager rehydrates from disk -> mission is "running" but
    // has no live execution; boot recovery must pause it.
    const m2 = new MissionManager({ store: new MissionStore({ baseDir }), now: makeClock() });
    await m2.init();
    expect(m2.getMission(mission.id)!.status).toBe(MissionStatus.Running);

    const applied = await applyBootRecovery(m2);
    expect(applied.map((i) => i.missionId)).toEqual([mission.id]);
    const recovered = m2.getMission(mission.id)!;
    expect(recovered.status).toBe(MissionStatus.Paused);
    expect(recovered.events.some((e) => e.type === 'boot-recovery')).toBe(true);

    // Idempotent: a second recovery pass does nothing.
    const again = await applyBootRecovery(m2);
    expect(again).toEqual([]);
  });
});

describe('heartbeat selection (§2.3)', () => {
  it('isHeartbeatActive excludes terminal / paused / waiting', async () => {
    const m = newManager();
    const a = await m.createMission({ title: 'active' });
    await m.updateStatus(a.id, MissionStatus.Running);
    const paused = await m.createMission({ title: 'p' });
    await m.updateStatus(paused.id, MissionStatus.Paused);
    const waiting = await m.createMission({ title: 'w' });
    await m.updateStatus(waiting.id, MissionStatus.WaitingApproval);
    const done = await m.createMission({ title: 'd' });
    await m.updateStatus(done.id, MissionStatus.Cancelled);

    expect(isHeartbeatActive(m.getMission(a.id)!)).toBe(true);
    expect(isHeartbeatActive(m.getMission(paused.id)!)).toBe(false);
    expect(isHeartbeatActive(m.getMission(waiting.id)!)).toBe(false);
    expect(isHeartbeatActive(m.getMission(done.id)!)).toBe(false);
  });

  it('selects only active missions whose last beat (or creation) is older than the interval', async () => {
    const m = newManager();
    const old = await m.createMission({ title: 'old' }); // createdAt ~ BASE
    await m.updateStatus(old.id, MissionStatus.Running);
    const paused = await m.createMission({ title: 'paused' });
    await m.updateStatus(paused.id, MissionStatus.Paused);

    const interval = DEFAULT_HEARTBEAT_INTERVAL_MS; // 15 min
    // 10 minutes after BASE: not yet due
    expect(selectDueMissions(m.listMissions(), iso(BASE + 10 * 60_000), interval)).toEqual([]);
    // 20 minutes after BASE: the running mission is due; paused never is
    const due = selectDueMissions(m.listMissions(), iso(BASE + 20 * 60_000), interval);
    expect(due.map((x) => x.id)).toEqual([old.id]);
  });

  it('a recent heartbeat resets the due clock (derived from the event log)', async () => {
    const m = newManager();
    const mission = await m.createMission({ title: 'beating' });
    await m.updateStatus(mission.id, MissionStatus.Running);
    // record a heartbeat at BASE+20min
    await m.recordEvent(mission.id, {
      type: HEARTBEAT_EVENT_TYPE,
      message: 'hb',
      ts: iso(BASE + 20 * 60_000),
    });
    expect(lastHeartbeatAt(m.getMission(mission.id)!)).toBe(iso(BASE + 20 * 60_000));
    // BASE+25min: only 5 min since last beat -> not due
    expect(selectDueMissions(m.listMissions(), iso(BASE + 25 * 60_000), DEFAULT_HEARTBEAT_INTERVAL_MS)).toEqual([]);
    // BASE+40min: 20 min since last beat -> due
    expect(
      selectDueMissions(m.listMissions(), iso(BASE + 40 * 60_000), DEFAULT_HEARTBEAT_INTERVAL_MS).map((x) => x.id),
    ).toEqual([mission.id]);
  });
});

describe('MissionHeartbeat.tick', () => {
  it('records a heartbeat event + emits mission:heartbeat for due missions, and resets due', async () => {
    const m = newManager();
    const mission = await m.createMission({ title: 'job' });
    await m.updateStatus(mission.id, MissionStatus.Running);

    const beats: string[] = [];
    m.on('mission:heartbeat', (id: string) => beats.push(id));

    const hb = new MissionHeartbeat({ manager: m, intervalMs: 15 * 60_000 });

    // First tick at BASE+20min: due -> beats once
    const due1 = await hb.tick(iso(BASE + 20 * 60_000));
    expect(due1.map((x) => x.id)).toEqual([mission.id]);
    expect(beats).toEqual([mission.id]);
    expect(
      m.getMission(mission.id)!.events.filter((e) => e.type === HEARTBEAT_EVENT_TYPE),
    ).toHaveLength(1);

    // Immediately after: not due again (last beat is recent)
    const due2 = await hb.tick(iso(BASE + 21 * 60_000));
    expect(due2).toEqual([]);
    expect(beats).toEqual([mission.id]); // unchanged
  });

  it('never beats paused / terminal missions', async () => {
    const m = newManager();
    const paused = await m.createMission({ title: 'p' });
    await m.updateStatus(paused.id, MissionStatus.Paused);
    const hb = new MissionHeartbeat({ manager: m, intervalMs: 1 });
    const due = await hb.tick(iso(BASE + 60 * 60_000));
    expect(due).toEqual([]);
  });
});
