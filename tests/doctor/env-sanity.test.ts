/** .env sanity — détection des accidents de collage, sans fuite de valeurs. */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { checkEnvContent, checkEnvSanity } from '../../src/doctor/env-sanity.js';

describe('checkEnvContent (pure)', () => {
  it('accepts a clean file (comments, blanks, plain values)', () => {
    const content = '# comment\n\nOPENAI_API_KEY=sk-abc\nPORT=3000\nNAME="two words"\n';
    expect(checkEnvContent(content)).toEqual([]);
  });

  it('flags shell commands pasted as values', () => {
    const issues = checkEnvContent(
      'A=export FOO=bar\nB=$env:PATH\nC=echo hi && rm -rf /\nD=sudo systemctl restart x\n',
    );
    expect(issues.map((i) => i.key)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('flags unbalanced quotes and duplicate keys (once)', () => {
    const issues = checkEnvContent('X="oops\nY=ok\nY=again\nY=third\n');
    expect(issues).toEqual([
      { key: 'X', issue: 'unbalanced quotes in value' },
      { key: 'Y', issue: 'duplicate key — the LAST occurrence silently wins' },
    ]);
  });

  it('never includes values in issue text (secrets)', () => {
    const issues = checkEnvContent('SECRET_KEY=export super-secret-value\n');
    expect(JSON.stringify(issues)).not.toContain('super-secret-value');
  });
});

describe('checkEnvSanity (fs)', () => {
  it('is ok when no .env exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'envsanity-'));
    const [check] = checkEnvSanity(dir);
    expect(check!.status).toBe('ok');
    expect(check!.message).toContain('no .env');
  });

  it('warns with key names on a broken .env', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'envsanity-'));
    await fs.writeFile(path.join(dir, '.env'), 'GROK_API_KEY=setx GROK_API_KEY xai-123\n');
    const [check] = checkEnvSanity(dir);
    expect(check!.status).toBe('warn');
    expect(check!.message).toContain('GROK_API_KEY');
    expect(check!.message).not.toContain('xai-123');
  });
});
