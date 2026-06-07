/**
 * Regression guard (CLAUDE.md, commit 5757b197): `@phuetz/ai-providers` was
 * INLINED into the source tree on purpose — the external workspace package /
 * symlink must NOT be reintroduced as a dependency. A reintroduced symlink
 * breaks reproducible installs and packaging. This test fails if any
 * package.json (cowork or repo root) declares it as a dependency again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const PACKAGE_JSONS = [
  fileURLToPath(new URL('../package.json', import.meta.url)), // cowork/package.json
  fileURLToPath(new URL('../../package.json', import.meta.url)), // repo root
];

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

describe('no @phuetz/ai-providers workspace dependency (regression guard)', () => {
  it('is not declared as a dependency in any package.json (it is inlined)', () => {
    const offenders: string[] = [];
    for (const file of PACKAGE_JSONS) {
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, Record<string, string> | undefined>;
      for (const field of DEP_FIELDS) {
        if (pkg[field] && Object.prototype.hasOwnProperty.call(pkg[field], '@phuetz/ai-providers')) {
          offenders.push(`${file} → ${field}`);
        }
      }
    }
    expect(
      offenders,
      `@phuetz/ai-providers was reintroduced as a dependency. It is intentionally ` +
        `inlined into the source tree (commit 5757b197) — remove the dependency/symlink.`,
    ).toEqual([]);
  });
});
