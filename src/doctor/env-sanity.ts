/**
 * `.env` sanity for `buddy doctor` — catches the classic paste accidents that
 * make a key "set but broken" (jarvis-OS preflight concept, clean-room):
 * a shell command pasted as a value (`export X=…`, `setx`, `$env:`, `&&`),
 * unbalanced quotes, and duplicate keys (the last one silently wins).
 *
 * SECRETS: never echo values — only key names and the problem's nature.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DoctorCheck } from './index.js';

export interface EnvIssue {
  key: string;
  issue: string;
}

const SHELL_PASTE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^\s*(export|setx|set)\s+/i, label: 'shell command pasted as value (`export`/`setx`/`set`)' },
  { re: /^\s*\$env:/i, label: 'PowerShell `$env:` pasted as value' },
  { re: /\s&&\s/, label: 'command chain (`&&`) inside the value' },
  { re: /^\s*sudo\s+/, label: '`sudo` pasted as value' },
];

function hasUnbalancedQuotes(value: string): boolean {
  const doubles = (value.match(/"/g) ?? []).length;
  const singles = (value.match(/'/g) ?? []).length;
  return doubles % 2 === 1 || singles % 2 === 1;
}

/** Pure content check — exported for tests. */
export function checkEnvContent(content: string): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const seen = new Map<string, number>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue; // pas une affectation — hors périmètre
    const key = line.slice(0, eq).trim().replace(/^export\s+/i, '');
    const value = line.slice(eq + 1);

    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) {
      issues.push({ key, issue: 'duplicate key — the LAST occurrence silently wins' });
    }

    for (const { re, label } of SHELL_PASTE_PATTERNS) {
      if (re.test(value)) {
        issues.push({ key, issue: label });
        break;
      }
    }
    if (hasUnbalancedQuotes(value)) {
      issues.push({ key, issue: 'unbalanced quotes in value' });
    }
  }
  return issues;
}

/** Doctor check over `<cwd>/.env` (absent file = nothing to check, ok). */
export function checkEnvSanity(cwd: string): DoctorCheck[] {
  const envPath = path.join(cwd, '.env');
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch {
    return [{ name: '.env sanity', status: 'ok', message: 'no .env file (nothing to check)' }];
  }
  const issues = checkEnvContent(content);
  if (issues.length === 0) {
    return [{ name: '.env sanity', status: 'ok', message: 'no paste accidents detected' }];
  }
  return [
    {
      name: '.env sanity',
      status: 'warn',
      message: issues.map((i) => `${i.key}: ${i.issue}`).join('; '),
    },
  ];
}
