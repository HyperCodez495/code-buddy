/**
 * Pattern-based Permissions
 *
 * Provides fine-grained permission control for tool executions using
 * glob-pattern matching. Rules are evaluated in order; first match wins.
 *
 * Tool specifier format:
 *   Bash(npm run *)     → matches Bash tool with commands starting "npm run "
 *   Edit(./src/**)      → matches Edit tool with paths under ./src/
 *   Read(./.env)        → matches Read tool on exactly ./.env
 *   WebFetch(domain:example.com) → matches WebFetch for a specific domain
 *   Bash                → matches all Bash invocations (no pattern)
 *
 * Pattern rules:
 *   *  → matches any characters except /
 *   ** → matches anything including /
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: PermissionAction;
}

export interface ParsedToolSpecifier {
  tool: string;
  pattern?: string;
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Convert a glob pattern to a RegExp.
 *   ** → matches anything (including /)
 *   *  → matches anything except /
 */
function globToRegex(pattern: string): RegExp {
  let result = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    if (char === undefined) {
      break;
    }

    if (char === '*' && pattern[i + 1] === '*') {
      // ** matches anything including /
      result += '.*';
      i += 2;
      // skip trailing / after **
      if (pattern[i] === '/') {
        i++;
      }
    } else if (char === '*') {
      // * matches anything except /
      result += '[^/]*';
      i++;
    } else if (char === '?') {
      result += '[^/]';
      i++;
    } else {
      // Escape regex special characters
      result += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp('^' + result + '$');
}

// ============================================================================
// PermissionPatternMatcher
// ============================================================================

export class PermissionPatternMatcher {
  private rules: PermissionRule[] = [];

  /**
   * Add a permission rule.
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * Check permission for a tool call. Evaluates rules in order; first match wins.
   * If no rule matches, returns 'ask' as default.
   */
  checkPermission(tool: string, input: string): PermissionAction {
    for (const rule of this.rules) {
      if (rule.tool !== tool) {
        continue;
      }

      // If rule has no pattern, it matches all invocations of this tool
      if (!rule.pattern) {
        return rule.action;
      }

      // Domain-based matching for WebFetch
      if (rule.pattern.startsWith('domain:')) {
        const domain = rule.pattern.slice('domain:'.length);
        if (input.includes(domain)) {
          return rule.action;
        }
        continue;
      }

      // Glob pattern matching
      const regex = globToRegex(rule.pattern);
      if (regex.test(input)) {
        return rule.action;
      }
    }

    // Default: ask
    return 'ask';
  }

  /**
   * Parse a tool specifier string like "Bash(npm run *)" into components.
   */
  parseToolSpecifier(spec: string): ParsedToolSpecifier {
    const match = spec.match(/^([A-Za-z_]+)(?:\((.+)\))?$/);
    if (!match || match[1] === undefined) {
      throw new Error(`Invalid tool specifier: ${spec}`);
    }

    return {
      tool: match[1],
      pattern: match[2] || undefined,
    };
  }

  /**
   * Load rules from an array of strings like "allow:Bash(npm run *)".
   */
  loadRules(ruleStrings: string[]): void {
    for (const ruleStr of ruleStrings) {
      const colonIndex = ruleStr.indexOf(':');
      if (colonIndex === -1) {
        logger.warn('Invalid rule string (missing action prefix)', { rule: ruleStr });
        continue;
      }

      const action = ruleStr.slice(0, colonIndex) as PermissionAction;
      if (action !== 'allow' && action !== 'ask' && action !== 'deny') {
        logger.warn('Invalid permission action', { action, rule: ruleStr });
        continue;
      }

      const specStr = ruleStr.slice(colonIndex + 1);
      const spec = this.parseToolSpecifier(specStr);

      this.addRule({
        tool: spec.tool,
        pattern: spec.pattern,
        action,
      });
    }
  }

  /**
   * Get all current rules.
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * Clear all rules.
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Remove a rule by index.
   */
  removeRule(index: number): void {
    if (index < 0 || index >= this.rules.length) {
      throw new Error(`Rule index out of bounds: ${index}`);
    }
    this.rules.splice(index, 1);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: PermissionPatternMatcher | null = null;

export function getPermissionMatcher(): PermissionPatternMatcher {
  if (!instance) {
    instance = new PermissionPatternMatcher();
  }
  return instance;
}

export function resetPermissionMatcher(): void {
  instance = null;
}
