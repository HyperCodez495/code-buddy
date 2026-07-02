/**
 * self_describe — the robot's live self-model of its constituent bricks.
 * Real fs (a temp repo root with fake bricks); no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSelfDescription, findRepoRoot } from '../../src/tools/self-describe.js';
import { createSelfDescribeTools, SelfDescribeTool } from '../../src/tools/registry/self-describe-tools.js';

function makeFakeRepo(opts: { senseBuilt?: boolean; memoryStub?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-selfmodel-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@phuetz/code-buddy', version: '9.9.9', description: 'test agent' }));
  // buddy-sense
  fs.mkdirSync(path.join(root, 'buddy-sense'), { recursive: true });
  fs.writeFileSync(path.join(root, 'buddy-sense', 'Cargo.toml'), '[package]\nname = "buddy-sense"\nversion = "0.1.0"\ndescription = "nerf multi-sensoriel"\n');
  if (opts.senseBuilt) fs.mkdirSync(path.join(root, 'buddy-sense', 'target', 'release'), { recursive: true });
  // buddy-vision
  fs.mkdirSync(path.join(root, 'buddy-vision'), { recursive: true });
  fs.writeFileSync(path.join(root, 'buddy-vision', 'README.md'), '# buddy-vision — les yeux\n\ndetails');
  fs.writeFileSync(path.join(root, 'buddy-vision', 'watch.py'), '# watch');
  // buddy-memory (stub = only target/)
  if (opts.memoryStub) fs.mkdirSync(path.join(root, 'buddy-memory', 'target'), { recursive: true });
  else fs.mkdirSync(path.join(root, 'buddy-memory'), { recursive: true });
  return root;
}

describe('buildSelfDescription', () => {
  let root: string;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('lists the three bricks with the right runtime status', () => {
    root = makeFakeRepo({ senseBuilt: true, memoryStub: true });
    const d = buildSelfDescription({ root, env: {}, toolNames: ['a', 'b', 'c'], personaRobotName: 'Lisa' });

    const byId = Object.fromEntries(d.bricks.map((b) => [b.id, b]));
    expect(byId['buddy-sense']!.present).toBe(true);
    expect(byId['buddy-sense']!.status).toBe('compilé');
    expect(byId['buddy-sense']!.description).toBe('nerf multi-sensoriel');
    expect(byId['buddy-vision']!.status).toMatch(/watch\.py/);
    expect(byId['buddy-memory']!.status).toMatch(/stub/i);

    expect(d.name).toBe('@phuetz/code-buddy');
    expect(d.version).toBe('9.9.9');
    expect(d.robotName).toBe('Lisa');
    expect(d.faculties.toolCount).toBe(3);
    // The speakable text mentions who it is and its bricks.
    expect(d.text).toMatch(/Lisa/);
    expect(d.text).toMatch(/buddy-sense/);
    expect(d.text).toMatch(/buddy-vision/);
    expect(d.text).toMatch(/buddy-memory/);
  });

  it('reports "présent (non compilé)" when buddy-sense is not built', () => {
    root = makeFakeRepo({ senseBuilt: false, memoryStub: true });
    const d = buildSelfDescription({ root, env: {} });
    const sense = d.bricks.find((b) => b.id === 'buddy-sense')!;
    expect(sense.status).toBe('présent (non compilé)');
  });

  it('detects active providers and sensors from env; never throws on a missing root', () => {
    root = makeFakeRepo();
    const d = buildSelfDescription({
      root,
      env: { OPENAI_API_KEY: 'x', OLLAMA_HOST: 'http://localhost:11434', CODEBUDDY_SENSORY_CAMERA: 'true', CODEBUDDY_REMINDERS: 'true' },
    });
    expect(d.faculties.activeProviders).toEqual(expect.arrayContaining(['OpenAI/ChatGPT', 'Ollama (local)']));
    expect(d.faculties.sensory).toEqual(expect.arrayContaining(['vision (caméra)', 'rappels']));

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
  it('is in the factory and returns a spoken self-description', async () => {
    const tools = createSelfDescribeTools();
    const tool = tools.find((t) => t.name === 'self_describe');
    expect(tool).toBeInstanceOf(SelfDescribeTool);

    const result = await tool!.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/brique/i); // narrates its bricks against the real repo
  });
});
