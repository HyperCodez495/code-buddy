import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

async function loadWithUserData(userData: string) {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => userData),
    },
  }));
  vi.doMock('../src/main/utils/logger', () => ({
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }));
  vi.doMock('../src/main/utils/core-loader', () => ({
    loadCoreModule: vi.fn(async () => ({
      getCommandsByCategory: () => ({
        general: [
          {
            name: 'review',
            description: 'Built-in review command',
            prompt: 'BUILTIN_REVIEW {{args}}',
            isBuiltin: true,
          },
        ],
      }),
    })),
  }));

  const serviceModule = await import('../src/main/commands/custom-commands-service');
  const bridgeModule = await import('../src/main/commands/slash-command-bridge');
  return { serviceModule, bridgeModule };
}

function makeUserData(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cowork-custom-commands-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.doUnmock('electron');
  vi.doUnmock('../src/main/utils/logger');
  vi.doUnmock('../src/main/utils/core-loader');
  vi.restoreAllMocks();
  vi.resetModules();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('CustomCommandsService', () => {
  it('seeds default custom commands in the userData directory', async () => {
    const userData = makeUserData();
    const { serviceModule } = await loadWithUserData(userData);
    const service = new serviceModule.CustomCommandsService();

    const commands = service.list();
    expect(commands.map((command) => command.name)).toEqual(['explain', 'review']);
    expect(service.getByName('review')?.prompt).toContain('senior engineer');
    expect(existsSync(path.join(userData, 'custom-commands', 'review.md'))).toBe(true);
  });

  it('saves commands with a sanitized slash name and serializes frontmatter', async () => {
    const userData = makeUserData();
    const { serviceModule } = await loadWithUserData(userData);
    const service = new serviceModule.CustomCommandsService();

    expect(
      service.save({
        name: '/QA Panel Proof!!',
        description: 'Panel command proof',
        body: 'Summarize the selected QA evidence: {{args}}',
      })
    ).toEqual({ success: true });

    const file = path.join(userData, 'custom-commands', 'qa-panel-proof.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('name: "qa-panel-proof"');
    expect(service.getByName('/qa-panel-proof')).toMatchObject({
      name: 'qa-panel-proof',
      description: 'Panel command proof',
      isBuiltin: false,
      category: 'custom',
    });
  });

  it('rejects invalid command drafts without writing files', async () => {
    const userData = makeUserData();
    const { serviceModule } = await loadWithUserData(userData);
    const service = new serviceModule.CustomCommandsService();

    expect(service.save({ name: '   ', description: 'Nope', body: 'Body' })).toMatchObject({
      success: false,
      error: 'Name and body are required',
    });
    expect(service.save({ name: 'valid', description: 'Nope', body: '   ' })).toMatchObject({
      success: false,
      error: 'Name and body are required',
    });
    expect(existsSync(path.join(userData, 'custom-commands', 'valid.md'))).toBe(false);
  });

  it('deletes a stored custom command', async () => {
    const userData = makeUserData();
    const { serviceModule } = await loadWithUserData(userData);
    const service = new serviceModule.CustomCommandsService();

    service.save({ name: 'cleanup-me', description: 'Temporary', body: 'Remove me' });
    const file = path.join(userData, 'custom-commands', 'cleanup-me.md');
    expect(existsSync(file)).toBe(true);

    expect(service.delete('cleanup-me')).toEqual({ success: true });
    expect(existsSync(file)).toBe(false);
  });

  it('exposes custom commands through SlashCommandBridge with custom precedence', async () => {
    const userData = makeUserData();
    const { serviceModule, bridgeModule } = await loadWithUserData(userData);
    const service = new serviceModule.CustomCommandsService();
    service.save({
      name: 'review',
      description: 'Custom review wins',
      body: 'CUSTOM_REVIEW {{args}}',
    });

    const bridge = new bridgeModule.SlashCommandBridge();
    const commands = await bridge.listCommands();
    const reviews = commands.filter((command) => command.name === 'review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      description: 'Custom review wins',
      isBuiltin: false,
      category: 'custom',
    });

    await expect(bridge.autocomplete('/rev')).resolves.toEqual([
      expect.objectContaining({ name: 'review', description: 'Custom review wins' }),
    ]);
    await expect(bridge.execute('review', ['ticket-42'])).resolves.toMatchObject({
      success: true,
      handled: false,
      prompt: 'CUSTOM_REVIEW ticket-42',
    });
    await expect(bridge.executeRemoteInput('/review ticket-43')).resolves.toMatchObject({
      allowed: true,
      prompt: 'CUSTOM_REVIEW ticket-43',
    });
  });
});
