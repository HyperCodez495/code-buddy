/**
 * CustomCommandsService — Phase 3 step 6
 *
 * Lets users define their own slash commands that live alongside
 * the built-in catalog. Each command is stored as a Markdown file
 * under `<userData>/custom-commands/` with YAML-ish frontmatter
 * for the name, description, and argument hints.
 *
 * @module main/commands/custom-commands-service
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { logWarn } from '../utils/logger';
import type { SlashCommandDef } from './slash-command-bridge';

const DEFAULTS: Record<string, { name: string; description: string; body: string }> = {
  'review': {
    name: 'review',
    description: 'Ask for a senior-engineer code review of the current diff',
    body: 'Review the current changes as if you were a senior engineer. Call out correctness issues first, then readability, then optional improvements. Be specific — include file paths and line numbers.',
  },
  'explain': {
    name: 'explain',
    description: 'Walk through a tricky piece of code',
    body: 'Walk me through the following piece of code step by step, calling out the purpose of each section and any non-obvious behavior:\n\n{{args}}',
  },
};

export class CustomCommandsService {
  private commandsDir: string;

  constructor() {
    this.commandsDir = path.join(app.getPath('userData'), 'custom-commands');
    this.ensureDir();
    this.seedDefaults();
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.commandsDir)) {
        fs.mkdirSync(this.commandsDir, { recursive: true });
      }
    } catch (err) {
      logWarn('[CustomCommandsService] ensureDir failed:', err);
    }
  }

  private seedDefaults(): void {
    try {
      for (const [id, cmd] of Object.entries(DEFAULTS)) {
        const file = path.join(this.commandsDir, `${id}.md`);
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file, this.serialize(cmd), 'utf-8');
        }
      }
    } catch (err) {
      logWarn('[CustomCommandsService] seedDefaults failed:', err);
    }
  }

  private parse(raw: string): { name: string; description: string; body: string } {
    const result = { name: '', description: '', body: '' };
    if (raw.startsWith('---\n')) {
      const end = raw.indexOf('\n---', 4);
      if (end > 0) {
        const front = raw.slice(4, end);
        result.body = raw.slice(end + 4).replace(/^\n/, '').replace(/\n$/, '');
        for (const line of front.split('\n')) {
          const idx = line.indexOf(':');
          if (idx <= 0) continue;
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (key === 'name') result.name = value;
          else if (key === 'description') result.description = value;
        }
        return result;
      }
    }
    result.body = raw;
    return result;
  }

  private serialize(cmd: { name: string; description: string; body: string }): string {
    return `---
name: "${cmd.name.replace(/"/g, '\\"')}"
description: "${cmd.description.replace(/"/g, '\\"')}"
---
${cmd.body}
`;
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^\//, '')
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  /** List all custom commands as SlashCommandDef so they can be merged into the palette. */
  list(): SlashCommandDef[] {
    try {
      if (!fs.existsSync(this.commandsDir)) return [];
      const files = fs.readdirSync(this.commandsDir).filter((f) => f.endsWith('.md'));
      const result: SlashCommandDef[] = [];
      for (const file of files) {
        const id = file.replace(/\.md$/, '');
        try {
          const raw = fs.readFileSync(path.join(this.commandsDir, file), 'utf-8');
          const parsed = this.parse(raw);
          result.push({
            name: parsed.name || id,
            description: parsed.description || '',
            prompt: parsed.body,
            category: 'custom',
            isBuiltin: false,
          });
        } catch {
          /* skip unreadable files */
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      logWarn('[CustomCommandsService] list failed:', err);
      return [];
    }
  }

  getByName(name: string): SlashCommandDef | null {
    const clean = this.sanitizeName(name);
    const file = path.join(this.commandsDir, `${clean}.md`);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = this.parse(raw);
      return {
        name: parsed.name || clean,
        description: parsed.description || '',
        prompt: parsed.body,
        category: 'custom',
        isBuiltin: false,
      };
    } catch {
      return null;
    }
  }

  save(cmd: {
    name: string;
    description: string;
    body: string;
  }): { success: boolean; error?: string } {
    try {
      if (!cmd.name.trim() || !cmd.body.trim()) {
        return { success: false, error: 'Name and body are required' };
      }
      const id = this.sanitizeName(cmd.name);
      if (!id) return { success: false, error: 'Invalid name' };
      fs.writeFileSync(
        path.join(this.commandsDir, `${id}.md`),
        this.serialize({ name: id, description: cmd.description, body: cmd.body }),
        'utf-8'
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  delete(name: string): { success: boolean; error?: string } {
    try {
      const file = path.join(this.commandsDir, `${this.sanitizeName(name)}.md`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

let instance: CustomCommandsService | null = null;
export function getCustomCommandsService(): CustomCommandsService {
  if (!instance) instance = new CustomCommandsService();
  return instance;
}
