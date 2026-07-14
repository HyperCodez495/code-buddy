import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

describe('CodeBuddyAvatar plugin bundle', () => {
  it('matches the complete source-tree manifest and safety contract', () => {
    const raw = execFileSync(
      process.execPath,
      [path.join(root, 'scripts', 'verify-unreal-avatar-plugin.mjs'), '--json'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(JSON.parse(raw)).toMatchObject({
      ok: true,
      bundleId: 'metahuman-split-a.5',
      files: 11,
    });
  });

  it('keeps authentication memory-only and animation capability fail-closed', () => {
    const config = readFileSync(
      path.join(root, 'integrations', 'unreal', 'CodeBuddyAvatar', 'Config', 'DefaultCodeBuddyAvatar.ini'),
      'utf8',
    );
    expect(config).toContain('bAudioDrivenAnimationEnabled=False');
    expect(config).not.toMatch(/(?:token|secret|api[_-]?key)\s*=/i);

    const readme = readFileSync(
      path.join(root, 'integrations', 'unreal', 'CodeBuddyAvatar', 'README.md'),
      'utf8',
    );
    expect(readme).toContain('Set Audio Driven Animation Ready(true)');
    expect(readme).toContain('MetaHuman Audio Live Link Source');
  });
});
