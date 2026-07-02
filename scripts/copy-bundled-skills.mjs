#!/usr/bin/env node
/**
 * Copy the bundled SKILL.md files into dist/ after tsc (which only emits JS).
 * getBundledSkillsPath() resolves them relative to the compiled module
 * (dist/skills/index.js → dist/skills/bundled/), so a built or published
 * package ships the same bundled tier a source checkout loads from
 * src/skills/bundled/.
 */
import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src', 'skills', 'bundled');
const outDir = join(root, 'dist', 'skills', 'bundled');

mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const entry of readdirSync(srcDir)) {
  if (!entry.endsWith('.md')) continue;
  copyFileSync(join(srcDir, entry), join(outDir, entry));
  copied++;
}
console.log(`copy-bundled-skills: ${copied} skill file(s) → dist/skills/bundled/`);
