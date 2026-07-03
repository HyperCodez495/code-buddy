/**
 * Verification Enforcement Middleware
 *
 * Checks if multiple files have been changed without running task_verify.
 * Warns the agent to consider running verification after modifying >= 3 files.
 *
 * Priority 155 — runs after auto-repair (150) to suggest verification
 * as a follow-up to successful repairs.
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Configuration ──────────────────────────────────────────────────

export interface VerificationEnforcementConfig {
  /** Enable/disable verification enforcement (default: true) */
  enabled: boolean;
  /** Minimum files changed before suggesting verification (default: 3) */
  fileThreshold: number;
  /** Tool names that count as verification (default: ['task_verify', 'run_tests']) */
  verificationTools: string[];
  /** History window to search for verification tool calls (default: 20) */
  historyWindow: number;
  /** Minimum WEB-UI files changed before nudging a browser check (default: 1) */
  webUiFileThreshold: number;
  /** Tool names that count as in-browser verification (default: web_test + browser family) */
  webVerificationTools: string[];
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationEnforcementConfig = {
  enabled: true,
  fileThreshold: 3,
  verificationTools: ['task_verify', 'run_tests'],
  historyWindow: 20,
  webUiFileThreshold: 1,
  webVerificationTools: ['web_test', 'browser', 'browser_navigate', 'browser_vision'],
};

/** Does this path look like web-UI code (worth a real browser check)? */
export function isWebUiFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (/\.(tsx|jsx|vue|svelte|html|css|scss)$/.test(normalized)) return true;
  return /\/(components|pages|views|renderer|ui|public)\//.test(normalized) && /\.(ts|js|mjs)$/.test(normalized);
}

// ── Middleware ──────────────────────────────────────────────────────

export class VerificationEnforcementMiddleware implements ConversationMiddleware {
  readonly name = 'verification-enforcement';
  readonly priority = 155;

  private config: VerificationEnforcementConfig;
  private hasWarned = false;
  private hasWarnedWebUi = false;

  constructor(config: Partial<VerificationEnforcementConfig> = {}) {
    this.config = { ...DEFAULT_VERIFICATION_CONFIG, ...config };
  }

  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!this.config.enabled) {
      return { action: 'continue' };
    }

    // Check if user explicitly skipped verification
    if (this.userSkippedVerification(context)) {
      return { action: 'continue' };
    }

    const changedFiles = this.collectChangedFiles(context);

    // Web-UI latch: UI code changed and nothing browser-based ran → nudge
    // the develop → launch → browse → verify loop. Independent of the
    // generic latch so a pure-UI task still gets the browser nudge.
    if (!this.hasWarnedWebUi) {
      const webUiFiles = changedFiles.filter(isWebUiFile);
      if (
        webUiFiles.length >= this.config.webUiFileThreshold &&
        !this.hasRecentTool(context, this.config.webVerificationTools)
      ) {
        this.hasWarnedWebUi = true;
        logger.info('Web-UI verification enforcement triggered', {
          webUiFiles: webUiFiles.length,
        });
        return {
          action: 'warn',
          message:
            `Web UI files changed (${webUiFiles.length}) without a browser check. ` +
            `Before declaring this done: app_server(start, command, url) → web_test(url, assertions) — ` +
            `the report shows console errors AND server logs. Fix, re-run, show the evidence.`,
        };
      }
    }

    // Generic latch (unchanged behavior).
    if (this.hasWarned) {
      return { action: 'continue' };
    }

    const changedCount = changedFiles.length;
    if (changedCount < this.config.fileThreshold) {
      return { action: 'continue' };
    }

    // Check if verification was already run recently
    if (this.hasRecentTool(context, this.config.verificationTools)) {
      return { action: 'continue' };
    }

    // All conditions met: warn
    this.hasWarned = true;

    logger.info('Verification enforcement triggered', {
      changedFiles: changedCount,
      threshold: this.config.fileThreshold,
    });

    return {
      action: 'warn',
      message:
        `Multiple files changed (${changedCount}). ` +
        `Consider running \`task_verify\` to ensure changes are correct.`,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private collectChangedFiles(context: MiddlewareContext): string[] {
    // Use changedFiles from context if available
    if (context.changedFiles && context.changedFiles.length > 0) {
      return [...context.changedFiles];
    }

    // Fall back: scan history for file-modifying tool calls
    const fileModifyingTools = new Set([
      'write_file', 'edit_file', 'str_replace', 'create_file',
      'apply_patch', 'file_write', 'str_replace_editor',
    ]);
    const modifiedFiles = new Set<string>();

    const window = context.history.slice(-this.config.historyWindow);
    for (const entry of window) {
      if (entry.type !== 'tool_result' && entry.type !== 'tool_call') continue;
      const toolName = entry.toolCall?.function?.name;
      if (!toolName || !fileModifyingTools.has(toolName)) continue;

      // Extract file path from arguments
      try {
        const args = JSON.parse(entry.toolCall?.function?.arguments || '{}');
        const filePath = args.path || args.file_path || args.file || args.filename;
        if (filePath) {
          modifiedFiles.add(filePath);
        }
      } catch {
        // Ignore parse errors
      }
    }

    return [...modifiedFiles];
  }

  private hasRecentTool(context: MiddlewareContext, toolNames: string[]): boolean {
    const window = context.history.slice(-this.config.historyWindow);

    for (const entry of window) {
      if (entry.type !== 'tool_result' && entry.type !== 'tool_call') continue;
      const toolName = entry.toolCall?.function?.name;
      if (toolName && toolNames.includes(toolName)) {
        return true;
      }
    }

    return false;
  }

  private userSkippedVerification(context: MiddlewareContext): boolean {
    const skipPatterns = [
      /skip\s+verification/i,
      /no\s+need\s+to\s+verify/i,
      /don'?t\s+verify/i,
      /skip\s+tests?/i,
    ];

    // Check recent user messages
    const recent = context.history.slice(-10);
    for (const entry of recent) {
      if (entry.type !== 'user') continue;
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (skipPatterns.some(p => p.test(content))) {
        return true;
      }
    }

    return false;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Reset the warning flags (e.g., on new task) */
  reset(): void {
    this.hasWarned = false;
    this.hasWarnedWebUi = false;
  }

  /** Check if warning has been issued */
  hasWarnedAlready(): boolean {
    return this.hasWarned;
  }

  /** Get configuration */
  getConfig(): VerificationEnforcementConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating the verification enforcement middleware.
 */
export function createVerificationEnforcementMiddleware(
  config?: Partial<VerificationEnforcementConfig>,
): VerificationEnforcementMiddleware {
  return new VerificationEnforcementMiddleware(config);
}
