import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the core loader so the bridge's headless routing uses a faithful fake of
// `executeHeadlessSlashToken` (it honours the real allow set the bridge passes).
vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modPath: string) => {
    if (modPath === 'commands/headless-slash.js') {
      return {
        executeHeadlessSlashToken: async (
          token: string,
          args: string[],
          allow: ReadonlySet<string>
        ) => {
          if (!allow.has(token)) {
            return { handled: true, denied: true, reason: `${token} not available` };
          }
          return { handled: true, output: `ran ${token} ${args.join(' ')}`.trim() };
        },
      };
    }
    return null;
  }),
}));

import { SlashCommandBridge } from '../src/main/commands/slash-command-bridge';

function bridgeWithCatalog(): SlashCommandBridge {
  const bridge = new SlashCommandBridge();
  bridge.listCommands = async () => [
    { name: 'stats', description: 'Show stats', prompt: '__STATS__', isBuiltin: true },
    { name: 'compact', description: 'Compact history', prompt: '__COMPACT__', isBuiltin: true },
    { name: 'model', description: 'Switch model', prompt: '__CHANGE_MODEL__', isBuiltin: true },
    { name: 'explain', description: 'Explain', prompt: 'Explain the following', isBuiltin: true },
    { name: 'swarm', description: 'Swarm', prompt: '__SWARM__', isBuiltin: true },
    { name: 'agents', description: 'Agents', prompt: '__AGENTS__', isBuiltin: true },
    { name: 'fleet', description: 'Fleet', prompt: '__FLEET__', isBuiltin: true },
    { name: 'team', description: 'Team', prompt: '__TEAM__', isBuiltin: true },
    { name: 'plan', description: 'Plan mode', prompt: '__PLAN_MODE__', isBuiltin: true },
    { name: 'lessons', description: 'Lessons', prompt: '__LESSONS__', isBuiltin: true },
  ];
  return bridge;
}

describe('SlashCommandBridge headless routing (S0)', () => {
  let bridge: SlashCommandBridge;
  beforeEach(() => {
    bridge = bridgeWithCatalog();
  });

  it('routes /model to a ui_effect with the target model as arg', async () => {
    const res = await bridge.execute('model', ['claude-opus-4-8']);
    expect(res.handled).toBe(true);
    expect(res.action).toEqual({
      type: 'ui_effect',
      uiEffect: 'open_model_picker',
      args: ['claude-opus-4-8'],
    });
    // ui_effect is resolved before the engine; no chat output.
    expect(res.output).toBeUndefined();
  });

  it('runs an allowlisted token headlessly and returns engine output (not a toast)', async () => {
    const res = await bridge.execute('stats', []);
    expect(res).toMatchObject({ success: true, handled: true });
    expect(res.output).toBe('ran __STATS__');
    expect(res.message).toBeUndefined();
  });

  it('denies a gated token with an honest message instead of running it', async () => {
    const res = await bridge.execute('compact', []);
    expect(res).toMatchObject({ success: true, handled: true });
    expect(res.output).toBeUndefined();
    expect(res.message).toContain('pas encore pilotable');
  });

  it('forwards a natural-language command as a prompt (handled:false)', async () => {
    const res = await bridge.execute('explain', ['this', 'code']);
    expect(res).toMatchObject({ success: true, handled: false });
    expect(res.prompt).toBe('Explain the following\n\nthis code');
    expect(res.action).toBeUndefined();
  });

  it('returns an error for an unknown command', async () => {
    const res = await bridge.execute('does-not-exist', []);
    expect(res.success).toBe(false);
    expect(res.error).toContain('does-not-exist');
  });

  // --- S1: multi-agent routing to Cowork-native effects ---

  it('routes /swarm <task> to a run_orchestrator ui_effect carrying the goal', async () => {
    const res = await bridge.execute('swarm', ['build', 'a', 'CLI']);
    expect(res.action).toEqual({
      type: 'ui_effect',
      uiEffect: 'run_orchestrator',
      args: ['build', 'a', 'CLI'],
    });
  });

  it('routes bare /swarm to the orchestrator launcher', async () => {
    const res = await bridge.execute('swarm', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'open_orchestrator_launcher' });
  });

  it('routes bare /agents to the orchestrator launcher', async () => {
    const res = await bridge.execute('agents', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'open_orchestrator_launcher' });
  });

  it('denies /agents <subcommand> honestly instead of silently opening a launcher', async () => {
    const res = await bridge.execute('agents', ['stop']);
    expect(res.action).toBeUndefined();
    expect(res.message).toContain('pas encore pilotable');
  });

  it('routes bare /fleet to the Fleet Command Center', async () => {
    const res = await bridge.execute('fleet', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'open_fleet' });
  });

  it('routes bare /team to the Team panel (S8)', async () => {
    const res = await bridge.execute('team', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'open_team' });
  });

  it('denies /team <subcommand> (subcommands not driven from Cowork yet)', async () => {
    const res = await bridge.execute('team', ['start']);
    expect(res.action).toBeUndefined();
    expect(res.message).toContain('pas encore pilotable');
  });

  it('routes /plan to the set_plan_mode ui_effect', async () => {
    const res = await bridge.execute('plan', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'set_plan_mode' });
  });

  it('routes /lessons to the lesson candidate panel (S8)', async () => {
    const res = await bridge.execute('lessons', []);
    expect(res.action).toMatchObject({ type: 'ui_effect', uiEffect: 'open_lessons' });
  });
});
