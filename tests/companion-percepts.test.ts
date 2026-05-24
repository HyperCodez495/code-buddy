import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionPerceptStats,
  formatCompanionPercepts,
  getCompanionPerceptStats,
  getCompanionPerceptsPath,
  readRecentCompanionPercepts,
  recordCompanionPercept,
} from '../src/companion/percepts.js';

describe('companion percept store', () => {
  let tempDir: string;
  let encryptionKeyBackup: string | undefined;
  let memoryKeyBackup: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-percepts-'));
    encryptionKeyBackup = process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    memoryKeyBackup = process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
    delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    delete process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
  });

  afterEach(async () => {
    if (encryptionKeyBackup !== undefined) {
      process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY = encryptionKeyBackup;
    } else {
      delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    }
    if (memoryKeyBackup !== undefined) {
      process.env.CODEBUDDY_COMPANION_MEMORY_KEY = memoryKeyBackup;
    } else {
      delete process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('records percepts as local workspace jsonl and returns newest first', async () => {
    const first = await recordCompanionPercept({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: 'Captured the desk',
      payload: { path: 'desk.png' },
      tags: ['camera', 'camera', 'vision'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00Z'),
    });
    const second = await recordCompanionPercept({
      modality: 'hearing',
      source: 'voice_loop',
      summary: 'Heard a user instruction',
      confidence: 0.8,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:01:00Z'),
    });

    expect(first.id).toContain('percept-20260524100000');
    expect(getCompanionPerceptsPath(tempDir)).toBe(path.join(tempDir, '.codebuddy', 'companion', 'percepts.jsonl'));

    const recent = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(recent.map(percept => percept.id)).toEqual([second.id, first.id]);
    expect(recent[1].tags).toEqual(['camera', 'vision']);
  });

  it('filters recent percepts by modality and reports stats', async () => {
    await recordCompanionPercept({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: 'Frame one',
    }, { cwd: tempDir });
    await recordCompanionPercept({
      modality: 'screen',
      source: 'screen_share',
      summary: 'Screen one',
    }, { cwd: tempDir });

    const recentVision = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'vision' });
    expect(recentVision).toHaveLength(1);
    expect(recentVision[0].summary).toBe('Frame one');

    const stats = await getCompanionPerceptStats({ cwd: tempDir });
    expect(stats.total).toBe(2);
    expect(stats.byModality).toEqual({ vision: 1, screen: 1 });
    expect(formatCompanionPerceptStats(stats)).toContain('By modality:');
    expect(formatCompanionPercepts(recentVision)).toContain('vision/camera_snapshot');
  });

  it('returns empty state for a workspace with no percept journal', async () => {
    await expect(readRecentCompanionPercepts({ cwd: tempDir })).resolves.toEqual([]);

    const stats = await getCompanionPerceptStats({ cwd: tempDir });
    expect(stats.exists).toBe(false);
    expect(stats.total).toBe(0);
    expect(formatCompanionPercepts([])).toContain('No companion percepts');
  });

  it('optionally encrypts percept summaries and payloads at rest', async () => {
    process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY = 'local-test-key';
    await recordCompanionPercept({
      modality: 'memory',
      source: 'privacy-test',
      summary: 'Remember the private phrase',
      payload: { secret: 'rose quartz' },
      tags: ['privacy'],
    }, { cwd: tempDir, now: new Date('2026-05-24T10:02:00Z') });

    const raw = await readFile(getCompanionPerceptsPath(tempDir), 'utf8');
    expect(raw).not.toContain('Remember the private phrase');
    expect(raw).not.toContain('rose quartz');
    expect(raw).toContain('"__encrypted":true');

    const decrypted = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(decrypted[0]).toMatchObject({
      summary: 'Remember the private phrase',
      payload: { secret: 'rose quartz' },
    });

    delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    const locked = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(locked[0].summary).toContain('key unavailable');
    expect(locked[0].payload).toMatchObject({ encrypted: true });
  });
});
