/**
 * Skill Bundles Command
 *
 * Group several installed skills under a single named slash-command "bundle"
 * so a whole set can be triggered at once. Parity with upstream
 * `hermes bundles`.
 *
 * A bundle = a name + an ordered list of installed skill IDs.
 *
 * Usage:
 *   buddy bundles list [--json]
 *   buddy bundles create <name> <skill...> [--json]
 *   buddy bundles show <name> [--json]
 *   buddy bundles remove <name> [--json]
 *
 * Bundles persist to ~/.codebuddy/bundles.json. Skill IDs are validated
 * against the installed set reported by the SkillsHub.
 */

import type { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Bundle Store
// ============================================================================

interface BundleEntry {
  name: string;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

interface BundleStore {
  version: number;
  bundles: Record<string, BundleEntry>;
}

/** Resolve the store path at call-time so HOME overrides apply (tests). */
function bundlesDir(): string {
  return path.join(homedir(), '.codebuddy');
}

function bundlesFile(): string {
  return path.join(bundlesDir(), 'bundles.json');
}

async function loadStore(): Promise<BundleStore> {
  try {
    const raw = await fs.readFile(bundlesFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BundleStore>;
    if (parsed && typeof parsed === 'object' && parsed.bundles && typeof parsed.bundles === 'object') {
      return { version: parsed.version ?? 1, bundles: parsed.bundles };
    }
    return { version: 1, bundles: {} };
  } catch {
    return { version: 1, bundles: {} };
  }
}

async function saveStore(store: BundleStore): Promise<void> {
  await fs.mkdir(bundlesDir(), { recursive: true });
  await fs.writeFile(bundlesFile(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Names of currently installed skills, used to validate bundle members. */
async function installedSkillNames(): Promise<Set<string>> {
  const { getSkillsHub } = await import('../../skills/hub.js');
  return new Set(getSkillsHub().list().map((skill) => skill.name));
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerBundlesCommands(program: Command): void {
  const bundles = program
    .command('bundles')
    .description('Group skills under a single named slash-command bundle');

  bundles
    .command('list')
    .description('List all defined skill bundles')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const store = await loadStore();
      const names = Object.keys(store.bundles).sort();

      if (opts.json) {
        console.log(JSON.stringify({
          count: names.length,
          bundles: names.map((name) => store.bundles[name]),
        }, null, 2));
        return;
      }

      if (names.length === 0) {
        console.log('No bundles defined. Use `buddy bundles create <name> <skill...>` to add one.');
        return;
      }
      console.log(`\nSkill bundles (${names.length}):\n`);
      for (const name of names) {
        const entry = store.bundles[name];
        if (!entry) continue;
        console.log(`  ${entry.name}: ${entry.skills.length} skill(s) — ${entry.skills.join(', ')}`);
      }
      console.log('');
    });

  bundles
    .command('create')
    .description('Create or replace a bundle from installed skill IDs')
    .argument('<name>', 'Bundle name')
    .argument('<skill...>', 'One or more installed skill IDs')
    .option('--json', 'output JSON')
    .action(async (name: string, skills: string[], opts: { json?: boolean }) => {
      const requested = Array.from(new Set(skills));
      const installed = await installedSkillNames();
      const missing = requested.filter((id) => !installed.has(id));

      if (missing.length > 0) {
        const message = `Unknown skill(s): ${missing.join(', ')}. Run \`buddy skills list\` to see installed skills.`;
        if (opts.json) {
          console.log(JSON.stringify({ created: false, error: message, missing, name }, null, 2));
        } else {
          console.error(message);
        }
        logger.warn('Bundle create rejected: unknown skills', { bundle: name, missing });
        process.exit(1);
        return;
      }

      const store = await loadStore();
      const now = new Date().toISOString();
      const existing = store.bundles[name];
      const entry: BundleEntry = {
        name,
        skills: requested,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      store.bundles[name] = entry;
      await saveStore(store);
      logger.info('Bundle saved', { bundle: name, skills: requested.length });

      if (opts.json) {
        console.log(JSON.stringify({ created: true, bundle: entry }, null, 2));
        return;
      }
      console.log(`Bundle '${name}' saved with ${requested.length} skill(s): ${requested.join(', ')}`);
    });

  bundles
    .command('show')
    .description('Show the skills in a bundle')
    .argument('<name>', 'Bundle name')
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      const store = await loadStore();
      const entry = store.bundles[name];
      if (!entry) {
        const message = `Bundle '${name}' not found.`;
        if (opts.json) {
          console.log(JSON.stringify({ bundle: null, error: message, name }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({ bundle: entry }, null, 2));
        return;
      }
      console.log(`\nBundle '${entry.name}' (${entry.skills.length} skill(s)):`);
      for (const skill of entry.skills) {
        console.log(`  - ${skill}`);
      }
      console.log(`\n  created ${entry.createdAt}, updated ${entry.updatedAt}\n`);
    });

  bundles
    .command('remove')
    .description('Remove a bundle')
    .argument('<name>', 'Bundle name')
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      const store = await loadStore();
      if (!store.bundles[name]) {
        const message = `Bundle '${name}' not found.`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, name, removed: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      delete store.bundles[name];
      await saveStore(store);
      logger.info('Bundle removed', { bundle: name });

      if (opts.json) {
        console.log(JSON.stringify({ name, removed: true }, null, 2));
        return;
      }
      console.log(`Bundle '${name}' removed.`);
    });
}
