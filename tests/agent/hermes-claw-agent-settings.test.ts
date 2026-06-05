import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  mapClawAgentBehavior,
  runClawMigration,
  buildClawMigrationPlan,
} from '../../src/agent/hermes-claw-migrate.js';

describe('mapClawAgentBehavior', () => {
  it('maps nested OpenClaw agent defaults to consumed CodeBuddySettings keys', () => {
    const out = mapClawAgentBehavior({
      agents: { defaults: { timeoutSeconds: 500, compaction: { mode: 'auto' } } },
      approvals: { exec: { mode: 'auto' } },
      theme: 'light',
    });
    expect(out).toEqual({
      maxToolRounds: 50, // 500s / 10 (upstream agent.max_turns)
      autoCompact: true,
      permissions: 'full-auto',
      theme: 'light',
    });
  });

  it('treats a small timeout as a turn count and compaction=off as disabled', () => {
    const out = mapClawAgentBehavior({ maxTurns: 80, compaction: { mode: 'off' } });
    expect(out.maxToolRounds).toBe(80);
    expect(out.autoCompact).toBe(false);
  });

  it('maps approval modes conservatively and ignores unknown values', () => {
    expect(mapClawAgentBehavior({ approvals: { mode: 'manual' } }).permissions).toBe('suggest');
    expect(mapClawAgentBehavior({ approvals: { mode: 'edits' } }).permissions).toBe('auto-edit');
    expect(mapClawAgentBehavior({ approvals: { mode: 'totally-made-up' } }).permissions).toBeUndefined();
  });

  it('ignores unknown themes', () => {
    expect(mapClawAgentBehavior({ theme: 'neon-rainbow' }).theme).toBeUndefined();
  });

  it('returns an empty object when nothing is mappable', () => {
    expect(mapClawAgentBehavior({ unrelated: true })).toEqual({});
  });
});

describe('claw migrate — agent behavior settings (real write)', () => {
  let tmp: string;
  let openclaw: string;
  let target: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-agent-settings-'));
    openclaw = path.join(tmp, '.openclaw');
    target = path.join(tmp, 'workspace');
    fs.ensureDirSync(openclaw);
    fs.ensureDirSync(target);
    fs.writeJsonSync(path.join(openclaw, 'clawdbot.json'), {
      agents: { defaults: { timeoutSeconds: 600, compaction: { mode: 'auto' } } },
      approvals: { exec: { mode: 'always' } },
      theme: 'dark',
    });
  });

  afterEach(() => {
    fs.removeSync(tmp);
  });

  it('plans the agent behavior import as a real import (not archive)', () => {
    const plan = buildClawMigrationPlan({ source: openclaw, workspaceTarget: target });
    const entry = plan.find((e) => e.category === 'agent_settings');
    expect(entry?.action).toBe('import');
    expect(entry?.label).toContain('maxToolRounds');
  });

  it('writes the mapped settings into .codebuddy/settings.json on apply', async () => {
    const report = await runClawMigration({
      source: openclaw,
      workspaceTarget: target,
      apply: true,
      backup: false,
    });
    const settingsEntry = report.entries.find((e) => e.category === 'agent_settings');
    expect(settingsEntry?.applied).toBe(true);

    const settings = fs.readJsonSync(path.join(target, '.codebuddy', 'settings.json'));
    expect(settings.maxToolRounds).toBe(60); // 600 / 10
    expect(settings.autoCompact).toBe(true);
    expect(settings.permissions).toBe('suggest'); // 'always' -> suggest
    expect(settings.theme).toBe('dark');
  });

  it('does not clobber existing settings unless --overwrite', async () => {
    const settingsPath = path.join(target, '.codebuddy', 'settings.json');
    fs.ensureDirSync(path.dirname(settingsPath));
    fs.writeJsonSync(settingsPath, { maxToolRounds: 999, theme: 'light' });

    await runClawMigration({ source: openclaw, workspaceTarget: target, apply: true, backup: false });
    let settings = fs.readJsonSync(settingsPath);
    expect(settings.maxToolRounds).toBe(999); // preserved
    expect(settings.theme).toBe('light'); // preserved
    expect(settings.autoCompact).toBe(true); // newly added (was absent)

    await runClawMigration({
      source: openclaw,
      workspaceTarget: target,
      apply: true,
      backup: false,
      overwrite: true,
    });
    settings = fs.readJsonSync(settingsPath);
    expect(settings.maxToolRounds).toBe(60); // overwritten
    expect(settings.theme).toBe('dark');
  });
});
