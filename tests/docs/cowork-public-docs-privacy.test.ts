import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicCoworkDoc = path.join(repoRoot, 'docs', 'cowork.md');
const publicCoworkQaDir = path.join(repoRoot, 'docs', 'qa', 'code-buddy-studio');

function publicTextFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return publicTextFiles(fullPath);
    return /\.(md|json)$/i.test(entry.name) ? [fullPath] : [];
  });
}

describe('Cowork public QA documentation privacy', () => {
  it('does not publish private ChatGPT account identifiers in text ledgers', () => {
    const files = [publicCoworkDoc, ...publicTextFiles(publicCoworkQaDir)];
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text, file).not.toContain('patrice.huetz');
    }
  });

  it('does not publish local workstation paths in the GitHub-facing Cowork overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    expect(text).not.toMatch(/[A-Z]:\\(?:Users|CascadeProjects)\\/i);
    expect(text).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
  });
});
