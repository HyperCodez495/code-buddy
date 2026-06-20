/**
 * Skill mutator — installs/removes an authored SKILL.md under
 * `.codebuddy/skills/authored/<name>/` with a proven inverse, and the firewall
 * scan used to gate authored skill content (run on a temp copy, never installed).
 *
 * @module agent/self-improvement/skill-mutator
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getSkillRegistry } from '../../skills/registry.js';
import { scanSkillFirewall } from '../../security/skill-scanner.js';
import type { SkillSpec } from './skill-types.js';

export const AUTHORED_SKILL_PREFIX = 'authored-';

export function toAuthoredSkillName(raw: string): string {
  const base = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.startsWith(AUTHORED_SKILL_PREFIX) ? base : `${AUTHORED_SKILL_PREFIX}${base || 'skill'}`;
}

export interface SkillFirewallCheck {
  safe: boolean;
  verdict: string;
  reasons: string[];
}

/** Write the skill body to a throwaway file and run the firewall scan (no install). */
export function scanAuthoredSkillContent(content: string): SkillFirewallCheck {
  const dir = path.join(os.tmpdir(), `cb-skillscan-${randomUUID()}`);
  const file = path.join(dir, 'SKILL.md');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  try {
    const report = scanSkillFirewall(file);
    return {
      safe: !report.quarantineRequired,
      verdict: String(report.verdict),
      reasons: report.quarantineRequired ? [report.summary] : [],
    };
  } catch (err) {
    // Fail closed: if the scanner errors, treat the skill as unsafe.
    return { safe: false, verdict: 'scan-error', reasons: [err instanceof Error ? err.message : String(err)] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface SkillMutatorPort {
  create(spec: SkillSpec): { name: string };
  remove(name: string): boolean;
  has(name: string): boolean;
}

/** Installs authored skills under <skillsRoot>/authored/<name>/SKILL.md. */
export class LiveSkillMutator implements SkillMutatorPort {
  private readonly skillsRoot: string;

  constructor(skillsRoot?: string) {
    this.skillsRoot = skillsRoot ?? path.join(process.cwd(), '.codebuddy', 'skills');
  }

  private dirFor(name: string): string {
    return path.join(this.skillsRoot, 'authored', name);
  }

  create(spec: SkillSpec): { name: string } {
    const dir = this.dirFor(spec.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), spec.content, 'utf-8');
    // Best-effort hot-reload; never block on it.
    void getSkillRegistry().reloadAll().catch(() => {});
    return { name: spec.name };
  }

  remove(name: string): boolean {
    const dir = this.dirFor(name);
    const existed = fs.existsSync(dir);
    if (existed) fs.rmSync(dir, { recursive: true, force: true });
    void getSkillRegistry().reloadAll().catch(() => {});
    return existed;
  }

  has(name: string): boolean {
    return fs.existsSync(path.join(this.dirFor(name), 'SKILL.md'));
  }
}
