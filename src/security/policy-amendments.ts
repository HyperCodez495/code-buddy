/**
 * Policy Amendment Suggestions
 *
 * When a command is blocked by security policy, suggests an allow rule
 * the user can accept to reduce friction in future sessions.
 * Accepted rules are persisted to .codebuddy/rules/.
 *
 * Inspired by OpenAI Codex CLI's exec_policy.rs
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface PolicyRule {
  /** Pattern to match (glob-style) */
  pattern: string;
  /** Decision: allow or deny */
  decision: 'allow' | 'deny';
  /** Scope: project or global */
  scope: 'project' | 'global';
  /** Tool this rule applies to (default: all) */
  tool?: string;
  /** When the rule was created */
  createdAt: string;
  /** Optional description */
  description?: string;
}

export interface AmendmentSuggestion {
  /** The suggested rule */
  rule: PolicyRule;
  /** Human-readable description */
  message: string;
}

// ============================================================================
// Banned patterns (never suggest allow rules for these)
// ============================================================================

const BANNED_COMMAND_PREFIXES = [
  'python', 'python3', 'node', 'ruby', 'perl',  // interpreters
  'bash', 'sh', 'zsh', 'cmd', 'powershell',     // shells
  'pip', 'npm', 'yarn', 'gem', 'cargo',          // package managers (too broad)
  'sudo', 'su', 'doas',                          // privilege escalation
  'curl', 'wget',                                 // network (too broad)
];

const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'format', 'mkfs',
  'dd', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'shutdown', 'reboot', 'halt',
]);

// ============================================================================
// Rules Store
// ============================================================================

const RULES_DIR = '.codebuddy/rules';
const RULES_FILE = 'allow-rules.json';

/** In-memory rules cache */
let _rules: PolicyRule[] | null = null;

function getRulesPath(cwd: string = process.cwd()): string {
  return path.join(cwd, RULES_DIR, RULES_FILE);
}

/**
 * Load rules from disk.
 */
export function loadRules(cwd: string = process.cwd()): PolicyRule[] {
  if (_rules) return _rules;

  const filePath = getRulesPath(cwd);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      _rules = JSON.parse(content) as PolicyRule[];
      return _rules;
    }
  } catch (err) {
    logger.debug(`Failed to load policy rules: ${err instanceof Error ? err.message : String(err)}`);
  }

  _rules = [];
  return _rules;
}

/**
 * Save rules to disk.
 */
function saveRules(rules: PolicyRule[], cwd: string = process.cwd()): void {
  const filePath = getRulesPath(cwd);
  const dir = path.dirname(filePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(rules, null, 2));
    _rules = rules;
  } catch (err) {
    logger.debug(`Failed to save policy rules: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Check if a command is allowed by stored rules.
 */
export function isCommandAllowed(command: string, cwd?: string): boolean {
  const rules = loadRules(cwd);
  const normalized = canonicalizeCommand(command);

  return rules.some(rule => {
    if (rule.decision !== 'allow') return false;
    return matchesPattern(normalized, rule.pattern);
  });
}

/**
 * Generate an amendment suggestion for a blocked command.
 * Returns null if the command is too dangerous to suggest allowing.
 */
export function suggestAmendment(
  command: string,
  toolName: string = 'bash',
): AmendmentSuggestion | null {
  const normalized = canonicalizeCommand(command);
  const firstWord = normalized.split(/\s+/)[0] ?? '';

  // Don't suggest for banned prefixes
  if (BANNED_COMMAND_PREFIXES.some(p => firstWord === p)) {
    return null;
  }

  // Don't suggest for dangerous commands
  if (DANGEROUS_COMMANDS.has(firstWord)) {
    return null;
  }

  // Generate a safe pattern: use the command with a trailing wildcard
  // e.g., "npm test" → "npm test*" (allows "npm test --watch" too)
  const pattern = `${normalized}*`;

  const rule: PolicyRule = {
    pattern,
    decision: 'allow',
    scope: 'project',
    tool: toolName,
    createdAt: new Date().toISOString(),
    description: `Auto-suggested for: ${command.substring(0, 100)}`,
  };

  return {
    rule,
    message: `Allow "${normalized}" (and variations) for this project?\n  Pattern: ${pattern}`,
  };
}

/**
 * Accept an amendment suggestion — persist the rule.
 */
export function acceptAmendment(rule: PolicyRule, cwd?: string): void {
  const rules = loadRules(cwd);
  // Deduplicate
  if (!rules.some(r => r.pattern === rule.pattern && r.tool === rule.tool)) {
    rules.push(rule);
    saveRules(rules, cwd);
    logger.info(`Policy rule added: allow "${rule.pattern}"`);
  }
}

/**
 * Remove a rule by pattern.
 */
export function removeRule(pattern: string, cwd?: string): boolean {
  const rules = loadRules(cwd);
  const idx = rules.findIndex(r => r.pattern === pattern);
  if (idx >= 0) {
    rules.splice(idx, 1);
    saveRules(rules, cwd);
    return true;
  }
  return false;
}

/**
 * Reset the rules cache (for testing).
 */
export function resetRulesCache(): void {
  _rules = null;
}

// ============================================================================
// Command Canonicalization (Feature 8 — integrated here)
// ============================================================================

/**
 * Normalize a shell command for consistent matching.
 * Strips shell wrappers (bash -c, sh -c) and normalizes whitespace.
 *
 * Inspired by OpenAI Codex CLI's command canonicalization.
 */
export function canonicalizeCommand(command: string): string {
  let cmd = command.trim();

  // Strip common shell wrappers
  const shellWrappers = [
    /^(?:\/bin\/)?(?:bash|sh|zsh|dash)\s+(?:-[lc]+\s+)*['"](.*)['"]\s*$/s,
    /^(?:\/bin\/)?(?:bash|sh|zsh|dash)\s+(?:-[lc]+\s+)+(.*)\s*$/s,
    /^cmd\s+\/[cC]\s+['"](.*)['"]\s*$/s,
    /^cmd\s+\/[cC]\s+(.*)\s*$/s,
    /^powershell\s+(?:-Command\s+)?['"](.*)['"]\s*$/s,
  ];

  for (const wrapper of shellWrappers) {
    const match = cmd.match(wrapper);
    if (match && match[1]) {
      cmd = match[1].trim();
      break;
    }
  }

  // Normalize whitespace
  cmd = cmd.replace(/\s+/g, ' ').trim();

  return cmd;
}

/** Shell operators that chain commands — block if present after the pattern match */
const SHELL_CHAIN_OPERATORS = /[;&|`$(){}]|&&|\|\|/;

/**
 * Safe glob pattern matching.
 * Rejects commands containing shell chaining operators after the matched prefix.
 */
function matchesPattern(command: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    if (!command.startsWith(prefix)) return false;
    // Check if the rest after prefix contains dangerous shell operators
    const remainder = command.slice(prefix.length);
    if (SHELL_CHAIN_OPERATORS.test(remainder)) return false;
    return true;
  }

  return command === pattern;
}
