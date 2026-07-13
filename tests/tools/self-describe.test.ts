/**
 * self_describe — the robot's live self-model of its constituent bricks.
 * Real fs (a temp repo root with fake bricks); no mocks.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import { ToolSelectionStrategy } from '../../src/agent/execution/tool-selection-strategy.js';
import { SELF_DESCRIBE_TOOL } from '../../src/codebuddy/tool-definitions/self-describe-tools.js';
import { getAllCodeBuddyTools, getBuiltinToolNames } from '../../src/codebuddy/tools.js';
import { buildSelfDescription, findRepoRoot } from '../../src/tools/self-describe.js';
import { createSelfDescribeTools, SelfDescribeTool } from '../../src/tools/registry/self-describe-tools.js';
import {
  FormalToolRegistry,
  getFormalToolRegistry,
} from '../../src/tools/registry/tool-registry.js';

function makeFakeRepo(opts: {
  senseBuilt?: boolean;
  memoryStub?: boolean;
  visionEar?: boolean;
} = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-selfmodel-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@phuetz/code-buddy', version: '9.9.9', description: 'test agent' }));
  // buddy-sense
  fs.mkdirSync(path.join(root, 'buddy-sense'), { recursive: true });
  fs.writeFileSync(path.join(root, 'buddy-sense', 'Cargo.toml'), '[package]\nname = "buddy-sense"\nversion = "0.1.0"\ndescription = "nerf multi-sensoriel"\n');
  if (opts.senseBuilt) {
    const releaseDir = path.join(root, 'buddy-sense', 'target', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'buddy-sense'), 'fake binary artifact');
  }
  // buddy-vision
  fs.mkdirSync(path.join(root, 'buddy-vision'), { recursive: true });
  fs.writeFileSync(path.join(root, 'buddy-vision', 'README.md'), '# buddy-vision — les yeux\n\ndetails');
  fs.writeFileSync(path.join(root, 'buddy-vision', 'watch.py'), '# watch');
  if (opts.visionEar) fs.writeFileSync(path.join(root, 'buddy-vision', 'ear.py'), '# ear');
  // buddy-memory (stub = only target/)
  if (opts.memoryStub) fs.mkdirSync(path.join(root, 'buddy-memory', 'target'), { recursive: true });
  else fs.mkdirSync(path.join(root, 'buddy-memory'), { recursive: true });
  return root;
}

describe('buildSelfDescription', () => {
  let root: string;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('lists the three bricks with verified source/build status only', () => {
    root = makeFakeRepo({ senseBuilt: true, memoryStub: true });
    const d = buildSelfDescription({
      root,
      env: {},
      toolNames: ['self_describe', 'search', 'view_file'],
      personaRobotName: 'Lisa',
    });

    const byId = Object.fromEntries(d.bricks.map((b) => [b.id, b]));
    expect(byId['buddy-sense']!.present).toBe(true);
    expect(byId['buddy-sense']!.status).toBe('binaire release présent (exécution non sondée)');
    expect(byId['buddy-sense']!.description).toBe('nerf multi-sensoriel');
    expect(byId['buddy-vision']!.status).toMatch(/watch\.py/);
    expect(byId['buddy-vision']!.status).not.toMatch(/ear\.py/);
    expect(byId['buddy-vision']!.status).toMatch(/exécution non sondée/);
    expect(byId['buddy-memory']!.status).toMatch(/stub/i);

    expect(d.name).toBe('@phuetz/code-buddy');
    expect(d.version).toBe('9.9.9');
    expect(d.robotName).toBe('Lisa');
    expect(d.faculties.toolCount).toBe(3);
    expect(d.faculties.selfInspectionTools).toEqual(['self_describe', 'view_file', 'search']);
    // The speakable text mentions who it is and its bricks.
    expect(d.text).toMatch(/Lisa/);
    expect(d.text).toMatch(/buddy-sense/);
    expect(d.text).toMatch(/buddy-vision/);
    expect(d.text).toMatch(/buddy-memory/);
    expect(d.text).toMatch(/Auto-inspection technique/);
    expect(d.text).toMatch(/ne constitue pas une conscience subjective/);
  });

  it('does not infer a compilation or runtime from an empty build directory', () => {
    root = makeFakeRepo({ senseBuilt: false, memoryStub: true });
    fs.mkdirSync(path.join(root, 'buddy-sense', 'target', 'release'), { recursive: true });
    const d = buildSelfDescription({ root, env: {} });
    const sense = d.bricks.find((b) => b.id === 'buddy-sense')!;
    expect(sense.status).toBe('source présente (aucun binaire détecté)');
  });

  it('lists exactly the visual scripts found on disk', () => {
    root = makeFakeRepo({ visionEar: true });
    const both = buildSelfDescription({ root, env: {} });
    const bothStatus = both.bricks.find((b) => b.id === 'buddy-vision')!.status;
    expect(bothStatus).toContain('watch.py, ear.py');

    fs.rmSync(path.join(root, 'buddy-vision', 'watch.py'));
    const earOnly = buildSelfDescription({ root, env: {} });
    const earOnlyStatus = earOnly.bricks.find((b) => b.id === 'buddy-vision')!.status;
    expect(earOnlyStatus).toContain('ear.py');
    expect(earOnlyStatus).not.toContain('watch.py,');
  });

  it('reports configured providers and sensory flags; never throws on a missing root', () => {
    root = makeFakeRepo();
    const d = buildSelfDescription({
      root,
      env: { OPENAI_API_KEY: 'x', OLLAMA_HOST: 'http://localhost:11434', CODEBUDDY_SENSORY_CAMERA: 'true', CODEBUDDY_REMINDERS: 'true' },
    });
    expect(d.faculties.activeProviders).toEqual(expect.arrayContaining(['OpenAI/ChatGPT', 'Ollama (local)']));
    expect(d.faculties.sensory).toEqual(expect.arrayContaining(['vision (caméra)', 'rappels']));
    expect(d.text).toContain('providers configurés (disponibilité non sondée)');
    expect(d.text).toContain('facultés sensorielles activées (matériel non sondé)');
    expect(d.text).not.toContain('providers actifs');
    expect(d.text).not.toContain('capteurs actifs');

    // A bogus root must not throw — bricks come back "non présent".
    const empty = buildSelfDescription({ root: '/nonexistent/path/xyz', env: {} });
    expect(empty.bricks.every((b) => !b.present)).toBe(true);
    expect(typeof empty.text).toBe('string');
  });

  it('findRepoRoot locates the dir holding buddy-sense + package.json', () => {
    root = makeFakeRepo();
    const nested = path.join(root, 'buddy-sense', 'target', 'release');
    fs.mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(fs.realpathSync(root));
  });
});

describe('SelfDescribeTool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    FormalToolRegistry.reset();
  });

  it('is in the factory and returns a spoken self-description', async () => {
    const tools = createSelfDescribeTools();
    const tool = tools.find((t) => t.name === 'self_describe');
    expect(tool).toBeInstanceOf(SelfDescribeTool);

    const result = await tool!.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/brique/i); // narrates its bricks against the real repo
  });

  it('is exposed once to the LLM and selected with code readers for introspection', async () => {
    vi.stubEnv('CODEBUDDY_DISABLE_MCP', 'true');
    vi.stubEnv('CODEBUDDY_LOAD_AUTHORED_TOOLS', 'false');

    expect(getBuiltinToolNames().filter((name) => name === 'self_describe')).toHaveLength(1);
    const exposed = (await getAllCodeBuddyTools())
      .filter((tool) => tool.function.name === 'self_describe');
    expect(exposed).toHaveLength(1);
    expect(exposed[0]).toEqual(SELF_DESCRIBE_TOOL);

    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    for (const request of [
      'étudie ton propre code',
      'fais une introspection technique',
      'comment fonctionnes-tu réellement ?',
      'quelles capacités sont actives ?',
      'es-tu consciente ?',
      'quelle version utilises-tu ?',
      'de quoi es-tu faite ?',
      'qui es-tu ?',
      'quelle est ton architecture ?',
      'quels capteurs sont actifs ?',
      'quelles sont tes limites ?',
    ]) {
      const selected = (await strategy.selectToolsForQuery(request)).tools
        .map((tool) => tool.function.name);
      expect(selected, request).toContain('self_describe');
      expect(selected, request).toContain('view_file');
      expect(selected, request).toContain('search');
    }
  });

  it('executes through the same interactive ToolHandler registry used by agent calls', async () => {
    FormalToolRegistry.reset();
    const handler = new ToolHandler({
      checkpointManager: {
        checkpointBeforeCreate: vi.fn(),
        checkpointBeforeEdit: vi.fn(),
      } as never,
      hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
      marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never,
    });

    expect(getFormalToolRegistry().has('self_describe')).toBe(true);
    const result = await handler.executeTool({
      id: 'call-self-describe',
      type: 'function',
      function: { name: 'self_describe', arguments: '{}' },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Auto-inspection technique');
    expect(result.output).toContain('ne constitue pas une conscience subjective');
  });
});
