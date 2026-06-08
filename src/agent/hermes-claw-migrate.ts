/**
 * Hermes `claw migrate` — migrate a legacy OpenClaw installation into Code Buddy.
 *
 * Mirrors the official NousResearch `hermes claw migrate` command surface
 * (source dir `~/.openclaw` with `~/.clawdbot`/`~/.moltbot` fallbacks, 30+
 * categories, `--preset full|user-data`, `--migrate-secrets`, `--dry-run`,
 * `--skill-conflict`, ...).
 *
 * Design rules (deliberate):
 * - **Dry-run by default.** Writing requires an explicit `apply: true`.
 * - **Offline + deterministic.** No LLM calls. Every "import" target is a real,
 *   consumer-backed destination (identity files read by the bootstrap loader /
 *   prompt builder, `.codebuddy/CODEBUDDY_MEMORY.md`, `.codebuddy/settings.json`
 *   `model`/`mcpServers` keys read by the model resolver / `loadMCPConfig`, the
 *   SkillsHub lockfile, project slash commands from `.codebuddy/commands/*.md`).
 *   Anything without a confirmed consumer is **archived** for manual review
 *   instead of written to a key nothing reads.
 * - **Secret-safe.** Plans/reports record credential *source names* only, never
 *   values. Secrets are migrated only with `migrateSecrets` and even then are
 *   written to a 0600 review file, never injected into live config in v1.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSkillsHub, type SkillsHub } from '../skills/hub.js';

export type ClawMigrationAction = 'import' | 'archive' | 'skip' | 'conflict';
export type ClawMigrationPreset = 'full' | 'user-data';
export type SkillConflictMode = 'skip' | 'overwrite' | 'rename';

export interface ClawMigrationOptions {
  /** Explicit OpenClaw home; otherwise the documented candidates are probed. */
  source?: string;
  /** Where workspace identity files (SOUL/USER/AGENTS) and `.codebuddy/` land. Default cwd. */
  workspaceTarget?: string;
  preset?: ClawMigrationPreset;
  migrateSecrets?: boolean;
  overwrite?: boolean;
  skillConflict?: SkillConflictMode;
  /** Pre-migration snapshot of the source dir. Default true (ignored on dry-run). */
  backup?: boolean;
  /** When true, actually write. Default false (dry-run). */
  apply?: boolean;
  /** Test seam: override the home dir used to probe OpenClaw candidates. */
  homeDir?: string;
  /**
   * Test/advanced seam: SkillsHub to install migrated skills into. Defaults to
   * the process-global `getSkillsHub()`. Injecting an isolated hub keeps tests
   * from touching the real `~/.codebuddy` skills hub (its dirs are fixed at
   * module load from `os.homedir()` and cannot be redirected by env).
   */
  skillsHub?: SkillsHub;
}

export interface ClawMigrationEntry {
  category: string;
  label: string;
  action: ClawMigrationAction;
  /** Source path or `config:<key>`; null when absent. */
  source: string | null;
  /** Resolved destination (path or `settings.json:<key>`); null when archived/skipped. */
  destination: string | null;
  detail: string;
  applied?: boolean;
  error?: string;
}

export interface ClawMigrationReport {
  kind: 'hermes_claw_migration';
  schemaVersion: 1;
  detected: boolean;
  openClawHome: string | null;
  workspaceTarget: string;
  preset: ClawMigrationPreset;
  migrateSecrets: boolean;
  dryRun: boolean;
  applied: boolean;
  backupPath: string | null;
  entries: ClawMigrationEntry[];
  summary: {
    import: number;
    archive: number;
    skip: number;
    conflict: number;
    appliedCount: number;
    failedCount: number;
    total: number;
  };
  notes: string[];
}

const HOME_CANDIDATES = ['.openclaw', '.clawdbot', '.moltbot'];
const CONFIG_NAMES = ['clawdbot.json', 'moltbot.json', 'openclaw.json', 'config.json'];
const SKILL_DIR_CANDIDATES = ['skills', 'agent/skills', '.skills', 'skill'];
const COMMAND_DIR_CANDIDATES = ['commands', 'slash-commands', 'agent/commands', '.commands'];

// Categories that `--preset user-data` keeps as imports (user content only).
const USER_DATA_IMPORTS = new Set(['persona', 'memory', 'user', 'agents', 'skills', 'commands']);

interface OpenClawConfig {
  raw: Record<string, unknown>;
  path: string;
}

/** A config-derived category that is archived (never imported) for review. */
interface ArchiveCategorySpec {
  category: string;
  /** Candidate config keys; the first present one becomes the archived slice. */
  keys: string[];
  /**
   * Candidate dotted paths for OpenClaw 2026.6.x's nested layout (e.g.
   * `models.providers`). Checked after {@link keys}; the first present one
   * becomes the archived slice.
   */
  paths?: string[];
  label: string;
  /** When true, the archive file may carry credentials → written with 0600. */
  sensitive?: boolean;
}

/**
 * Archive categories whose slice can embed credentials. Their review files are
 * chmod 0600 like `secrets.json` (best-effort; no-op where chmod is unsupported).
 */
const SENSITIVE_ARCHIVE_CATEGORIES = new Set<string>(['hooks', 'webhooks', 'portal', 'secrets', 'custom_providers']);

/**
 * Dev-only invariant: every config key is claimed by at most one archive spec.
 * Two specs sharing a key would archive the same slice into two files. Throws
 * in non-production so the mistake is caught in tests; silent no-op otherwise.
 */
function assertUniqueArchiveKeys(specs: ArchiveCategorySpec[]): void {
  if (process.env.NODE_ENV === 'production') return;
  const seen = new Map<string, string>();
  for (const spec of specs) {
    for (const key of spec.keys) {
      const prior = seen.get(key);
      if (prior && prior !== spec.category) {
        throw new Error(
          `hermes-claw-migrate: config key "${key}" claimed by both "${prior}" and "${spec.category}".`,
        );
      }
      seen.set(key, spec.category);
    }
  }
}

/** Resolve the OpenClaw home: explicit `source`, else first existing candidate. */
export function detectOpenClawHome(opts: ClawMigrationOptions = {}): string | null {
  if (opts.source) {
    return fs.existsSync(opts.source) ? path.resolve(opts.source) : null;
  }
  const home = opts.homeDir ?? os.homedir();
  for (const candidate of HOME_CANDIDATES) {
    const full = path.join(home, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return full;
    }
  }
  return null;
}

function readConfig(home: string): OpenClawConfig | null {
  for (const name of CONFIG_NAMES) {
    const full = path.join(home, name);
    if (fs.existsSync(full)) {
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        return { raw, path: full };
      } catch {
        // Malformed config — surfaced as a skip entry by the caller.
        return { raw: {}, path: full };
      }
    }
  }
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstRecord(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

/** Resolve a dotted path (e.g. `agents.defaults.timeoutSeconds`) in a config tree. */
function nestedValue(obj: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split('.')) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function firstDefined(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const p of paths) {
    const v = nestedValue(obj, p);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Like {@link firstString} but resolves dotted paths, so OpenClaw 2026.6.x's
 * nested layout (e.g. `agents.defaults.model.primary`) is read alongside the
 * legacy flat `clawdbot` keys. Returns the first path that resolves to a
 * non-empty string (skipping object/undefined intermediates), trimmed.
 */
function firstStringPath(obj: Record<string, unknown>, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = nestedValue(obj, p);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// Default-model lookup paths. OpenClaw 2026.6.x nests the resolved default under
// `agents.defaults.model.primary`; older clawdbot/moltbot configs used a flat
// root `model`. Both shapes are tried (2026.6.x first) so a real install of
// either imports its default model. `firstStringPath` skips the object-valued
// `agents.defaults.model` intermediate and keeps scanning.
const CLAW_MODEL_PATHS = [
  'agents.defaults.model.primary',
  'agents.defaults.model',
  'model',
  'defaultModel',
  'default_model',
];

/**
 * Agent-behavior defaults that map cleanly onto real, consumed
 * `CodeBuddySettings` keys (src/config/settings-hierarchy.ts). Mirrors the
 * fields upstream `hermes claw migrate` imports directly (rather than archiving).
 */
export interface ClawAgentBehaviorSettings {
  maxToolRounds?: number;
  autoCompact?: boolean;
  permissions?: 'suggest' | 'auto-edit' | 'full-auto';
  theme?: string;
}

// OpenClaw exec-approval modes -> Code Buddy permission modes. Unknown values
// fall through (left unmapped) rather than guessing an unsafe autonomy level.
const CLAW_APPROVAL_MODE_MAP: Record<string, ClawAgentBehaviorSettings['permissions']> = {
  never: 'full-auto', auto: 'full-auto', autonomous: 'full-auto', yolo: 'full-auto', off: 'full-auto',
  edits: 'auto-edit', autoedit: 'auto-edit', 'auto-edit': 'auto-edit', 'auto_edit': 'auto-edit',
  always: 'suggest', ask: 'suggest', manual: 'suggest', suggest: 'suggest', prompt: 'suggest',
};
const CLAW_VALID_THEMES = new Set(['dark', 'light', 'default', 'minimal', 'colorful']);

/**
 * Translate OpenClaw agent-behavior config into the subset of CodeBuddySettings
 * that has confirmed live consumers. Only well-understood, safely-typed fields
 * are mapped; everything else stays archived for manual review.
 */
export function mapClawAgentBehavior(cfg: Record<string, unknown>): ClawAgentBehaviorSettings {
  const out: ClawAgentBehaviorSettings = {};

  // maxToolRounds <- agents.defaults.timeoutSeconds / 10 (upstream agent.max_turns).
  // A small value (<=400) is already a turn count; a large one is seconds.
  const turns = firstDefined(cfg, [
    'agents.defaults.timeoutSeconds', 'agent.timeoutSeconds', 'timeoutSeconds', 'maxTurns', 'maxToolRounds',
  ]);
  if (typeof turns === 'number' && turns > 0) {
    out.maxToolRounds = turns > 400 ? Math.max(1, Math.round(turns / 10)) : Math.round(turns);
  }

  // autoCompact <- compaction mode (off/disabled -> false).
  const comp = firstDefined(cfg, [
    'agents.defaults.compaction.mode', 'agent.compaction.mode', 'compaction.mode', 'compactionMode',
  ]);
  if (typeof comp === 'string') {
    out.autoCompact = !['off', 'disabled', 'none', 'false'].includes(comp.toLowerCase());
  } else if (typeof comp === 'boolean') {
    out.autoCompact = comp;
  }

  // permissions <- approvals.exec.mode (conservative enum map).
  const appr = firstDefined(cfg, [
    'approvals.exec.mode', 'approvals.mode', 'approval.exec.mode', 'approval.mode',
  ]);
  if (typeof appr === 'string') {
    const mapped = CLAW_APPROVAL_MODE_MAP[appr.toLowerCase()];
    if (mapped) out.permissions = mapped;
  }

  // theme <- theme / ui.theme (only known Code Buddy themes).
  const theme = firstDefined(cfg, ['theme', 'ui.theme', 'appearance.theme']);
  if (typeof theme === 'string' && CLAW_VALID_THEMES.has(theme.toLowerCase())) {
    out.theme = theme.toLowerCase();
  }

  return out;
}

/** Discover OpenClaw skill directories: each subdir containing a `SKILL.md`. */
function discoverSkillDirs(home: string): Array<{ name: string; skillFile: string }> {
  const found: Array<{ name: string; skillFile: string }> = [];
  const seen = new Set<string>();
  for (const rel of SKILL_DIR_CANDIDATES) {
    const root = path.join(home, rel);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(root, entry.name, 'SKILL.md');
      const safeName = entry.name.replace(/[^a-zA-Z0-9_-]/g, '-');
      if (fs.existsSync(skillFile) && !seen.has(safeName)) {
        seen.add(safeName);
        found.push({ name: safeName, skillFile });
      }
    }
  }
  return found;
}

/** Discover OpenClaw custom slash command files consumable by Code Buddy. */
function discoverCommandFiles(home: string): Array<{ name: string; source: string }> {
  const found: Array<{ name: string; source: string }> = [];
  const seen = new Set<string>();
  for (const rel of COMMAND_DIR_CANDIDATES) {
    const root = path.join(home, rel);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const safeName = path.basename(entry.name, '.md').replace(/[^a-zA-Z0-9_-]/g, '-');
      if (!safeName || seen.has(safeName)) continue;
      seen.add(safeName);
      found.push({ name: safeName, source: path.join(root, entry.name) });
    }
  }
  return found;
}

/** Credential-bearing keys whose presence we report by name only (never value). */
function detectSecretSourceNames(config: Record<string, unknown>): string[] {
  const names: string[] = [];
  const buckets = ['apiKeys', 'api_keys', 'secrets', 'tokens', 'credentials'];
  for (const bucket of buckets) {
    const record = firstRecord(config, [bucket]);
    if (record) names.push(...Object.keys(record));
  }
  // Top-level *_token / *_key / *_secret style keys.
  for (const key of Object.keys(config)) {
    if (/(token|api[_-]?key|secret)$/i.test(key) && typeof config[key] === 'string') {
      names.push(key);
    }
  }
  return Array.from(new Set(names));
}

interface BuildContext {
  home: string;
  config: OpenClawConfig | null;
  preset: ClawMigrationPreset;
  migrateSecrets: boolean;
  target: string;
  codebuddyDir: string;
}

/** Resolve the action for a directly-importable category given the preset. */
function importOrPresetArchive(category: string, ctx: BuildContext): ClawMigrationAction {
  if (ctx.preset === 'user-data' && !USER_DATA_IMPORTS.has(category)) return 'archive';
  return 'import';
}

function settingsKeyDest(ctx: BuildContext, key: string): string {
  return `${path.join(ctx.codebuddyDir, 'settings.json')}:${key}`;
}

/** Build the migration plan (read-only; no writes). */
export function buildClawMigrationPlan(opts: ClawMigrationOptions = {}): ClawMigrationEntry[] {
  const home = detectOpenClawHome(opts);
  const entries: ClawMigrationEntry[] = [];
  if (!home) return entries;

  const target = path.resolve(opts.workspaceTarget ?? process.cwd());
  const codebuddyDir = path.join(target, '.codebuddy');
  const config = readConfig(home);
  const ctx: BuildContext = {
    home,
    config,
    preset: opts.preset ?? 'full',
    migrateSecrets: opts.migrateSecrets === true,
    target,
    codebuddyDir,
  };

  // --- Directly imported identity files (consumed by bootstrap loader / prompt builder) ---
  const identityFiles: Array<{ category: string; file: string; dest: string }> = [
    { category: 'persona', file: 'SOUL.md', dest: path.join(target, 'SOUL.md') },
    { category: 'user', file: 'USER.md', dest: path.join(target, 'USER.md') },
    { category: 'agents', file: 'AGENTS.md', dest: path.join(target, 'AGENTS.md') },
  ];
  for (const { category, file, dest } of identityFiles) {
    const src = path.join(home, file);
    if (fs.existsSync(src)) {
      entries.push({
        category,
        label: file,
        action: importOrPresetArchive(category, ctx),
        source: src,
        destination: dest,
        detail: `OpenClaw ${file} -> workspace ${file} (loaded as identity/bootstrap context).`,
      });
    } else {
      entries.push({ category, label: file, action: 'skip', source: null, destination: null, detail: `No ${file} in source.` });
    }
  }

  // --- MEMORY.md -> project memory file ---
  {
    const src = path.join(home, 'MEMORY.md');
    const dest = path.join(codebuddyDir, 'CODEBUDDY_MEMORY.md');
    if (fs.existsSync(src)) {
      entries.push({
        category: 'memory',
        label: 'MEMORY.md',
        action: importOrPresetArchive('memory', ctx),
        source: src,
        destination: dest,
        detail: 'Appended under a "Migrated from OpenClaw" heading in the project memory file.',
      });
    } else {
      entries.push({ category: 'memory', label: 'MEMORY.md', action: 'skip', source: null, destination: null, detail: 'No MEMORY.md in source.' });
    }
  }

  // --- Skills -> SkillsHub ---
  {
    const skills = discoverSkillDirs(home);
    if (skills.length === 0) {
      entries.push({ category: 'skills', label: 'skills', action: 'skip', source: null, destination: null, detail: 'No SKILL.md directories found in source.' });
    } else {
      for (const skill of skills) {
        entries.push({
          category: 'skills',
          label: `skill:${skill.name}`,
          action: importOrPresetArchive('skills', ctx),
          source: skill.skillFile,
          destination: `SkillsHub:${skill.name}`,
          detail: 'Installed via SkillsHub.installFromContent (honors --skill-conflict).',
        });
      }
    }
  }

  // --- Custom slash commands -> .codebuddy/commands/*.md ---
  {
    const commands = discoverCommandFiles(home);
    if (commands.length === 0) {
      entries.push({
        category: 'commands',
        label: 'custom slash commands',
        action: 'skip',
        source: null,
        destination: null,
        detail: 'No custom command Markdown files found in source.',
      });
    } else {
      for (const command of commands) {
        entries.push({
          category: 'commands',
          label: `command:/${command.name}`,
          action: importOrPresetArchive('commands', ctx),
          source: command.source,
          destination: path.join(codebuddyDir, 'commands', `${command.name}.md`),
          detail: 'Copied to .codebuddy/commands/*.md for the built-in custom slash command loader.',
        });
      }
    }
  }

  // --- Config-derived categories ---
  const cfg = config?.raw ?? {};

  // default model + thinking level -> .codebuddy/settings.json (consumed by model resolver)
  const model = firstStringPath(cfg, CLAW_MODEL_PATHS);
  if (model) {
    entries.push({
      category: 'model',
      label: 'default model',
      action: importOrPresetArchive('model', ctx),
      source: `config:model`,
      destination: settingsKeyDest(ctx, 'model'),
      detail: `Default model "${model}".`,
    });
  } else {
    entries.push({ category: 'model', label: 'default model', action: 'skip', source: null, destination: null, detail: 'No model in config.' });
  }

  // MCP servers -> .codebuddy/settings.json mcpServers (consumed by loadMCPConfig)
  const mcp = firstRecord(cfg, ['mcpServers', 'mcp_servers', 'mcp']);
  if (mcp && Object.keys(mcp).length > 0) {
    entries.push({
      category: 'mcp_servers',
      label: `mcp servers (${Object.keys(mcp).length})`,
      action: importOrPresetArchive('mcp_servers', ctx),
      source: 'config:mcpServers',
      destination: settingsKeyDest(ctx, 'mcpServers'),
      detail: `Merged servers: ${Object.keys(mcp).join(', ')}.`,
    });
  } else {
    entries.push({ category: 'mcp_servers', label: 'mcp servers', action: 'skip', source: null, destination: null, detail: 'No MCP servers in config.' });
  }

  // --- Agent behavior defaults -> .codebuddy/settings.json (directly imported) ---
  // Mirrors upstream `hermes claw migrate`, which imports these into config keys
  // rather than archiving them. Only fields with a confirmed CodeBuddySettings
  // consumer are mapped (mapClawAgentBehavior); the rest stay archived below.
  {
    const behavior = mapClawAgentBehavior(cfg);
    const mappedKeys = Object.keys(behavior);
    if (mappedKeys.length > 0) {
      entries.push({
        category: 'agent_settings',
        label: `agent behavior (${mappedKeys.join(', ')})`,
        action: importOrPresetArchive('agent_settings', ctx),
        source: 'config:agents.defaults',
        destination: settingsKeyDest(ctx, mappedKeys.join('+')),
        detail: `Imported: ${mappedKeys
          .map((k) => `${k}=${JSON.stringify((behavior as Record<string, unknown>)[k])}`)
          .join(', ')}.`,
      });
    } else {
      entries.push({ category: 'agent_settings', label: 'agent behavior defaults', action: 'skip', source: null, destination: null, detail: 'No mappable agent behavior defaults in config.' });
    }
  }

  // --- Archived-for-review categories (no confirmed live consumer / safety) ---
  //
  // Each category is archived (never imported) because Code Buddy has no
  // consumer that reads the exact OpenClaw shape — promoting a wrong-shaped
  // value into a live key (e.g. tool *names* vs shell-command patterns, or an
  // out-of-enum permission mode) would be worse than archiving it for manual
  // review. `keys` are matched against the parsed config; the first present key
  // becomes the archived slice. **Keys must be unique across all specs** so a
  // single config key never lands in two archive files (asserted below in dev).
  const archiveCategories: ArchiveCategorySpec[] = [
    // OpenClaw 2026.6.x stores custom OpenAI-compatible providers under
    // `models.providers.<name>` (baseUrl/api/apiKey/models). Archived (never
    // imported): the shape differs from Code Buddy's provider config and the
    // block carries an apiKey, so it is sensitive (0600) and left for review.
    { category: 'custom_providers', keys: ['providers', 'customProviders', 'custom_providers'], paths: ['models.providers'], label: 'custom providers', sensitive: true },
    { category: 'messaging', keys: ['channels', 'messaging', 'platforms'], label: 'messaging / channels platform config' },
    { category: 'tts', keys: ['tts', 'textToSpeech', 'voice'], label: 'TTS / voice config' },
    { category: 'browser', keys: ['browser', 'browserSettings', 'browserBackend'], label: 'browser automation settings' },
    { category: 'tool_settings', keys: ['tools', 'toolSettings', 'tool_settings'], label: 'tool settings' },
    { category: 'command_allowlist', keys: ['commandAllowlist', 'allowlist', 'allowedCommands'], label: 'command allowlist' },
    { category: 'gateway', keys: ['gateway', 'gatewayConfig'], label: 'gateway config' },
    { category: 'cron', keys: ['cron', 'cronJobs', 'cronjobs'], label: 'cron jobs' },
    { category: 'plugins', keys: ['plugins'], label: 'plugins' },
    // `hooks` and `webhooks` are split so each lands in its own archive slice;
    // both can carry shell commands / credentials, so both archive (never run).
    { category: 'hooks', keys: ['hooks', 'lifecycleHooks'], label: 'lifecycle hooks', sensitive: true },
    { category: 'webhooks', keys: ['webhooks', 'webhookEndpoints'], label: 'webhook endpoints', sensitive: true },
    { category: 'memory_backend', keys: ['memoryBackend', 'memory_backend'], label: 'memory backend' },
    { category: 'agent_defaults', keys: ['agent', 'agentDefaults', 'multiAgent'], label: 'agent defaults / multi-agent' },
    { category: 'session_policies', keys: ['session', 'sessionReset', 'sessionPolicies'], label: 'session reset policies' },
    { category: 'approval_rules', keys: ['approval', 'approvalRules'], label: 'approval rules' },
    { category: 'exec_timeout', keys: ['execTimeout', 'exec_timeout', 'timeout'], label: 'exec timeout' },
    // --- Expanded category set (toward upstream `hermes claw migrate` parity) ---
    { category: 'toolsets', keys: ['toolsets', 'toolSets', 'toolset'], label: 'toolsets' },
    { category: 'profiles', keys: ['profiles', 'agentProfiles'], label: 'agent profiles' },
    { category: 'bundles', keys: ['bundles', 'skillBundles'], label: 'bundles' },
    { category: 'pairing', keys: ['pairing', 'pairedDevices', 'devices'], label: 'device pairing / allowlist' },
    { category: 'vision', keys: ['vision', 'visionSettings'], label: 'vision config' },
    { category: 'image_video', keys: ['image', 'video', 'media'], label: 'image / video generation config' },
    { category: 'runtimes', keys: ['runtimes', 'backends', 'runtime'], label: 'runtime backends (Docker/SSH/Modal/Daytona)' },
    { category: 'portal', keys: ['portal', 'nousPortal', 'toolGateway'], label: 'Nous Portal Tool Gateway config', sensitive: true },
    { category: 'learning_loop', keys: ['learning', 'learningLoop', 'trajectory'], label: 'closed learning-loop config' },
    { category: 'kanban', keys: ['kanban', 'kanbanBoard'], label: 'kanban board config' },
  ];

  // Dev-only invariant: a config key must not be claimed by two specs (would
  // archive the same slice into two files). Cheap O(n) guard, no-op in prod.
  assertUniqueArchiveKeys(archiveCategories);

  for (const spec of archiveCategories) {
    // Root keys first (legacy flat clawdbot), then dotted paths (2026.6.x).
    const present = spec.keys.find((k) => cfg[k] !== undefined)
      ?? spec.paths?.find((p) => nestedValue(cfg, p) !== undefined);
    entries.push({
      category: spec.category,
      label: spec.label,
      action: present ? 'archive' : 'skip',
      source: present ? `config:${present}` : null,
      destination: present ? path.join(codebuddyDir, 'openclaw-migration', 'archive', `${spec.category}.json`) : null,
      detail: present
        ? 'Archived for manual review (no confirmed live consumer in Code Buddy).'
        : 'Not present in source.',
    });
  }

  // --- Secrets (gated; archived to a review file, never auto-applied) ---
  {
    const names = detectSecretSourceNames(cfg);
    if (names.length === 0) {
      entries.push({ category: 'secrets', label: 'API keys / secrets', action: 'skip', source: null, destination: null, detail: 'No credential keys detected.' });
    } else if (!ctx.migrateSecrets) {
      entries.push({
        category: 'secrets',
        label: `API keys / secrets (${names.length})`,
        action: 'skip',
        source: 'config:secrets',
        destination: null,
        detail: `Detected: ${names.join(', ')}. Re-run with --migrate-secrets to archive them to a 0600 review file.`,
      });
    } else {
      entries.push({
        category: 'secrets',
        label: `API keys / secrets (${names.length})`,
        action: 'archive',
        source: 'config:secrets',
        destination: path.join(codebuddyDir, 'openclaw-migration', 'archive', 'secrets.json'),
        detail: `Detected: ${names.join(', ')}. Archived to a 0600 review file; never injected into live config.`,
      });
    }
  }

  return entries;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function backupSource(home: string, codebuddyDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(codebuddyDir, 'openclaw-migration', 'backup', stamp);
  ensureDir(backupRoot);
  // Shallow recursive copy of the source tree (fs.cpSync available on Node >= 16.7).
  fs.cpSync(home, path.join(backupRoot, path.basename(home)), { recursive: true });
  return backupRoot;
}

function applyEntry(entry: ClawMigrationEntry, opts: ClawMigrationOptions, ctx: ApplyContext): void {
  const overwrite = opts.overwrite === true;
  switch (entry.category) {
    case 'persona':
    case 'user':
    case 'agents': {
      if (!entry.source || !entry.destination) return;
      if (fs.existsSync(entry.destination) && !overwrite) {
        entry.action = 'conflict';
        entry.detail = `Exists; pass --overwrite to replace. ${entry.detail}`;
        return;
      }
      ensureDir(path.dirname(entry.destination));
      fs.copyFileSync(entry.source, entry.destination);
      entry.applied = true;
      return;
    }
    case 'memory': {
      if (!entry.source || !entry.destination) return;
      ensureDir(path.dirname(entry.destination));
      const incoming = fs.readFileSync(entry.source, 'utf-8').trimEnd();
      const block = `\n\n## Migrated from OpenClaw (${new Date().toISOString()})\n\n${incoming}\n`;
      fs.appendFileSync(entry.destination, block, 'utf-8');
      entry.applied = true;
      return;
    }
    case 'skills': {
      if (!entry.source) return;
      const name = entry.label.replace(/^skill:/, '');
      const hub = opts.skillsHub ?? getSkillsHub();
      const installed = hub.list().some((s) => s.name === name);
      const mode: SkillConflictMode = opts.skillConflict ?? 'skip';
      let targetName = name;
      if (installed) {
        if (mode === 'skip') {
          entry.action = 'skip';
          entry.detail = `Skill "${name}" already installed (--skill-conflict skip).`;
          return;
        }
        if (mode === 'rename') targetName = `${name}-openclaw`;
        // 'overwrite' keeps the same name.
      }
      const content = fs.readFileSync(entry.source, 'utf-8');
      // installFromContent is async; applyEntry stays sync, so we queue via the
      // promise but record optimistic success. Callers await applyClawMigration's
      // returned promise which resolves after all skill installs settle.
      ctx.pendingSkillInstalls.push(
        hub
          .installFromContent(targetName, content, 'local')
          .then(() => {
            entry.applied = true;
            entry.destination = `SkillsHub:${targetName}`;
          })
          .catch((err: unknown) => {
            entry.error = err instanceof Error ? err.message : String(err);
          }),
      );
      return;
    }
    case 'commands': {
      if (!entry.source || !entry.destination) return;
      if (fs.existsSync(entry.destination) && !overwrite) {
        entry.action = 'conflict';
        entry.detail = `Exists; pass --overwrite to replace. ${entry.detail}`;
        return;
      }
      ensureDir(path.dirname(entry.destination));
      fs.copyFileSync(entry.source, entry.destination);
      entry.applied = true;
      return;
    }
    case 'model': {
      if (!entry.destination) return;
      mergeSettings(ctx, (settings) => {
        const model = firstStringPath(ctx.config?.raw ?? {}, CLAW_MODEL_PATHS);
        if (model) settings.model = model;
        const thinking = firstString(ctx.config?.raw ?? {}, ['thinkingLevel', 'thinking_level', 'reasoning']);
        if (thinking) settings.thinkingLevel = thinking;
      });
      entry.applied = true;
      return;
    }
    case 'mcp_servers': {
      if (!entry.destination) return;
      const mcp = firstRecord(ctx.config?.raw ?? {}, ['mcpServers', 'mcp_servers', 'mcp']);
      if (!mcp) return;
      mergeSettings(ctx, (settings) => {
        const existing = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
        settings.mcpServers = overwrite ? { ...existing, ...mcp } : { ...mcp, ...existing };
      });
      entry.applied = true;
      return;
    }
    case 'agent_settings': {
      const behavior = mapClawAgentBehavior(ctx.config?.raw ?? {});
      if (Object.keys(behavior).length === 0) return;
      mergeSettings(ctx, (settings) => {
        // Don't clobber an existing user value unless --overwrite.
        const set = (key: string, value: unknown) => {
          if (value !== undefined && (overwrite || settings[key] === undefined)) settings[key] = value;
        };
        set('maxToolRounds', behavior.maxToolRounds);
        set('autoCompact', behavior.autoCompact);
        set('permissions', behavior.permissions);
        set('theme', behavior.theme);
      });
      entry.applied = true;
      return;
    }
    default: {
      // Archive categories -> write the raw config slice to the review dir.
      if (entry.action !== 'archive' || !entry.destination || !entry.source) return;
      ensureDir(path.dirname(entry.destination));
      const slice = sliceForArchive(entry, ctx);
      fs.writeFileSync(entry.destination, JSON.stringify(slice, null, 2), 'utf-8');
      if (SENSITIVE_ARCHIVE_CATEGORIES.has(entry.category)) {
        try {
          fs.chmodSync(entry.destination, 0o600);
        } catch {
          /* best-effort on platforms without chmod */
        }
      }
      entry.applied = true;
    }
  }
}

function sliceForArchive(entry: ClawMigrationEntry, ctx: BuildContext): unknown {
  const cfg = ctx.config?.raw ?? {};
  const key = entry.source?.replace(/^config:/, '');
  if (!key) return { note: entry.detail };
  if (cfg[key] !== undefined) return { [key]: cfg[key] };
  // OpenClaw 2026.6.x nested layout (e.g. `models.providers`).
  const nested = nestedValue(cfg, key);
  if (nested !== undefined) return { [key]: nested };
  return { note: entry.detail };
}

function mergeSettings(ctx: BuildContext, mutate: (settings: Record<string, unknown>) => void): void {
  const settingsPath = path.join(ctx.codebuddyDir, 'settings.json');
  ensureDir(ctx.codebuddyDir);
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  mutate(settings);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// Extend BuildContext with a place to collect async skill installs during apply.
interface ApplyContext extends BuildContext {
  pendingSkillInstalls: Array<Promise<void>>;
}

/**
 * Build a plan and, unless dry-run, apply it. Returns a unified report.
 */
export async function runClawMigration(opts: ClawMigrationOptions = {}): Promise<ClawMigrationReport> {
  const home = detectOpenClawHome(opts);
  const target = path.resolve(opts.workspaceTarget ?? process.cwd());
  const codebuddyDir = path.join(target, '.codebuddy');
  const dryRun = opts.apply !== true;
  const preset = opts.preset ?? 'full';
  const migrateSecrets = opts.migrateSecrets === true;

  const entries = buildClawMigrationPlan(opts);
  const notes: string[] = [];
  let backupPath: string | null = null;

  if (home && !dryRun) {
    const config = readConfig(home);
    const ctx: ApplyContext = {
      home,
      config,
      preset,
      migrateSecrets,
      target,
      codebuddyDir,
      pendingSkillInstalls: [],
    };

    if (opts.backup !== false) {
      try {
        backupPath = backupSource(home, codebuddyDir);
        notes.push(`Pre-migration snapshot written to ${backupPath}.`);
      } catch (err) {
        notes.push(`Backup failed (continuing): ${err instanceof Error ? err.message : String(err)}.`);
      }
    }

    for (const entry of entries) {
      if (entry.action !== 'import' && entry.action !== 'archive') continue;
      try {
        applyEntry(entry, opts, ctx);
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
    await Promise.all(ctx.pendingSkillInstalls);
  }

  if (!home) {
    notes.push(
      `No OpenClaw installation found. Looked for ${HOME_CANDIDATES.map((c) => `~/${c}`).join(', ')} ` +
        `or pass --source <path>.`,
    );
  } else if (dryRun) {
    notes.push('Dry-run: no files were written. Re-run with --apply to migrate.');
  }
  if (!migrateSecrets && home) {
    notes.push('Secrets are not migrated. Pass --migrate-secrets to archive credentials to a review file.');
  }

  const summary = {
    import: entries.filter((e) => e.action === 'import').length,
    archive: entries.filter((e) => e.action === 'archive').length,
    skip: entries.filter((e) => e.action === 'skip').length,
    conflict: entries.filter((e) => e.action === 'conflict').length,
    appliedCount: entries.filter((e) => e.applied === true).length,
    failedCount: entries.filter((e) => Boolean(e.error)).length,
    total: entries.length,
  };

  return {
    kind: 'hermes_claw_migration',
    schemaVersion: 1,
    detected: Boolean(home),
    openClawHome: home,
    workspaceTarget: target,
    preset,
    migrateSecrets,
    dryRun,
    applied: Boolean(home) && !dryRun,
    backupPath,
    entries,
    summary,
    notes,
  };
}

export function renderClawMigrationReport(report: ClawMigrationReport): string {
  const lines: string[] = [];
  lines.push('');
  if (!report.detected) {
    lines.push('OpenClaw migration: no source installation detected.');
    for (const note of report.notes) lines.push(`  - ${note}`);
    return lines.join('\n');
  }
  lines.push(`OpenClaw migration ${report.dryRun ? '(dry-run)' : '(applied)'}`);
  lines.push(`  Source:    ${report.openClawHome}`);
  lines.push(`  Target:    ${report.workspaceTarget}`);
  lines.push(`  Preset:    ${report.preset}   Secrets: ${report.migrateSecrets ? 'included' : 'excluded'}`);
  if (report.backupPath) lines.push(`  Backup:    ${report.backupPath}`);
  lines.push(
    `  Summary:   ${report.summary.import} import, ${report.summary.archive} archive, ` +
      `${report.summary.skip} skip, ${report.summary.conflict} conflict` +
      (report.dryRun ? '' : ` (${report.summary.appliedCount} applied, ${report.summary.failedCount} failed)`),
  );
  lines.push('');
  for (const entry of report.entries) {
    if (entry.action === 'skip') continue;
    const mark = entry.error ? 'x' : entry.applied ? '+' : entry.action === 'conflict' ? '!' : '.';
    lines.push(`  [${mark}] ${entry.action.padEnd(7)} ${entry.label} — ${entry.detail}`);
    if (entry.error) lines.push(`        error: ${entry.error}`);
  }
  lines.push('');
  for (const note of report.notes) lines.push(`  - ${note}`);
  return lines.join('\n');
}
