/**
 * Learning-First Memory Middleware
 *
 * Detects user correction signals (e.g., "no", "wrong", "actually",
 * "use X instead") and persists them to .codebuddy/AGENTS.md as
 * learned corrections. Injects a <context type="learned_correction">
 * system message so the model immediately adapts.
 *
 * Priority 35 — runs between context-warning (30) and reasoning (42).
 *
 * DeepAgents Sprint 1 — Learning-First Memory.
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Correction signal patterns ──────────────────────────────────────

/**
 * Regex patterns that indicate the user is correcting the agent.
 * Derived from memory-consolidation.ts MEMORY_SIGNALS with additional
 * explicit correction phrases.
 */
const CORRECTION_SIGNALS: RegExp[] = [
  /\b(?:no|nope|wrong|incorrect|that's wrong|that is wrong)\b/i,
  /\b(?:actually|instead|not like that|not that)\b/i,
  /\b(?:I said|I told you|I meant|I asked for)\b/i,
  /\b(?:don't do that|do not do that|stop doing that)\b/i,
  /\b(?:use .+ instead|switch to|change to|replace with)\b/i,
  /\b(?:correct(?:ion)?)\s*[,:]/i,
  /\b(?:prefer|always|never)\s+/i,
];

// ── Configuration ────────────────────────────────────────────────────

export interface LearningFirstConfig {
  /** Enable/disable learning-first middleware (default: true) */
  enabled: boolean;
  /** Maximum corrections to store per session (default: 50) */
  maxCorrections: number;
  /** Path to persist corrections (default: .codebuddy/AGENTS.md) */
  agentsFilePath: string;
}

export const DEFAULT_LEARNING_FIRST_CONFIG: LearningFirstConfig = {
  enabled: true,
  maxCorrections: 50,
  agentsFilePath: '.codebuddy/AGENTS.md',
};

// ── Middleware ────────────────────────────────────────────────────────

export class LearningFirstMiddleware implements ConversationMiddleware {
  readonly name = 'learning-first';
  readonly priority = 35;

  private config: LearningFirstConfig;
  /** Normalized set of already-seen corrections (prevents duplicates) */
  private seenCorrections = new Set<string>();
  /** Error pattern tracking for auto-lesson generation */
  private errorPatterns: Map<string, number> = new Map();
  /** Auto-lessons created this session (rate limited) */
  private autoLessonsCreated = 0;
  /** Maximum auto-lessons per session */
  private static readonly MAX_AUTO_LESSONS_PER_SESSION = 2;

  constructor(config: Partial<LearningFirstConfig> = {}) {
    this.config = { ...DEFAULT_LEARNING_FIRST_CONFIG, ...config };
  }

  async beforeTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!this.config.enabled) {
      return { action: 'continue' };
    }

    // Find the latest user message
    const latestUserMessage = this.findLatestUserMessage(context);
    if (!latestUserMessage) {
      return { action: 'continue' };
    }

    // Check for correction signals
    if (!this.hasCorrectionSignal(latestUserMessage)) {
      return { action: 'continue' };
    }

    // Check for duplicate
    const normalized = this.normalize(latestUserMessage);
    if (this.seenCorrections.has(normalized)) {
      return { action: 'continue' };
    }

    // Guard max corrections
    if (this.seenCorrections.size >= this.config.maxCorrections) {
      return { action: 'continue' };
    }

    // Track the correction
    this.seenCorrections.add(normalized);

    // Persist to .codebuddy/AGENTS.md
    await this.persistCorrection(latestUserMessage);

    // Inject correction context
    logger.info(`Learning-first: detected correction signal, injecting context`);

    return {
      action: 'warn',
      message: `<context type="learned_correction">\nUser correction detected: "${latestUserMessage.slice(0, 200)}"\nThis correction has been recorded. Adjust behavior accordingly.\n</context>`,
    };
  }

  /**
   * After each turn: track error patterns and auto-create lessons
   * when the same error occurs >= 3 times.
   */
  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!this.config.enabled) {
      return { action: 'continue' };
    }

    // Use state bag if available for cross-middleware error pattern sharing
    const stateKey = 'learning-first:errorPatterns';
    if (context.state) {
      const storedPatterns = context.getState?.<Map<string, number>>(stateKey);
      if (storedPatterns) {
        // Merge stored patterns into our tracking
        for (const [key, count] of storedPatterns) {
          this.errorPatterns.set(key, Math.max(this.errorPatterns.get(key) || 0, count));
        }
      }
    }

    // Scan recent tool results for errors
    if (context.lastToolResults) {
      for (const result of context.lastToolResults) {
        if (result.success) continue;

        const errorKey = this.normalizeErrorPattern(result.output);
        if (!errorKey) continue;

        const count = (this.errorPatterns.get(errorKey) || 0) + 1;
        this.errorPatterns.set(errorKey, count);

        // Auto-create lesson when threshold reached
        if (count >= 3 && this.autoLessonsCreated < LearningFirstMiddleware.MAX_AUTO_LESSONS_PER_SESSION) {
          await this.createAutoLesson(errorKey, result.toolName, count);
          this.autoLessonsCreated++;

          logger.info('Learning-first: auto-lesson created from repeated error', {
            errorPattern: errorKey.slice(0, 100),
            tool: result.toolName,
            occurrences: count,
            totalAutoLessons: this.autoLessonsCreated,
          });
        }
      }
    }

    // Also scan history for tool_result entries with error indicators
    const recentHistory = context.history.slice(-6);
    for (const entry of recentHistory) {
      if (entry.type !== 'tool_result') continue;
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!content) continue;

      // Check for error indicators
      const hasError = /error|fail|exception|syntaxerror|typeerror/i.test(content);
      if (!hasError) continue;

      const errorKey = this.normalizeErrorPattern(content);
      if (!errorKey) continue;

      const count = (this.errorPatterns.get(errorKey) || 0) + 1;
      this.errorPatterns.set(errorKey, count);

      if (count >= 3 && this.autoLessonsCreated < LearningFirstMiddleware.MAX_AUTO_LESSONS_PER_SESSION) {
        const toolName = entry.toolCall?.function?.name || 'unknown';
        await this.createAutoLesson(errorKey, toolName, count);
        this.autoLessonsCreated++;
      }
    }

    // Store error patterns in state bag for other middlewares
    if (context.state) {
      context.setState?.(stateKey, new Map(this.errorPatterns));
    }

    return { action: 'continue' };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Normalize an error message into a pattern key for deduplication.
   * Lowercases, strips numbers, collapses whitespace, takes first line.
   */
  private normalizeErrorPattern(output: string): string | null {
    const firstLine = output.split('\n').find(l => l.trim().length > 0);
    if (!firstLine || firstLine.trim().length < 10) return null;

    return firstLine
      .toLowerCase()
      .replace(/\d+/g, 'N')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  /**
   * Create a lesson from a repeated error pattern via LessonsTracker.
   */
  private async createAutoLesson(errorKey: string, toolName: string, count: number): Promise<void> {
    try {
      const { getLessonsTracker } = await import('../lessons-tracker.js');
      const tracker = getLessonsTracker();

      tracker.add(
        'PATTERN',
        `Repeated error in \`${toolName}\` (seen ${count}x): ${errorKey.slice(0, 300)}. Consider an alternative approach when encountering this error.`,
        'self_observed',
        toolName,
      );
    } catch (err) {
      logger.debug('Learning-first: failed to create auto-lesson', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private findLatestUserMessage(context: MiddlewareContext): string | null {
    // Walk history from the end to find the last user message
    for (let i = context.history.length - 1; i >= 0; i--) {
      const entry = context.history[i];
      if (!entry) continue;
      if (entry.type === 'user' && typeof entry.content === 'string' && entry.content.trim()) {
        return entry.content.trim();
      }
    }
    return null;
  }

  /**
   * Check if a message contains one or more correction signals.
   */
  hasCorrectionSignal(message: string): boolean {
    return CORRECTION_SIGNALS.some(pattern => pattern.test(message));
  }

  /**
   * Normalize a correction string for deduplication.
   * Lowercases, trims, collapses whitespace.
   */
  private normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  /**
   * Append correction to .codebuddy/AGENTS.md (non-blocking best-effort).
   */
  private async persistCorrection(correction: string): Promise<void> {
    try {
      const { writeFile, readFile, mkdir } = await import('fs/promises');
      const { join } = await import('path');

      const dir = join(process.cwd(), '.codebuddy');
      await mkdir(dir, { recursive: true });

      const filePath = join(process.cwd(), this.config.agentsFilePath);
      let existing = '';
      try {
        existing = await readFile(filePath, 'utf-8');
      } catch { /* file may not exist */ }

      const timestamp = new Date().toISOString().slice(0, 19);
      const entry = `\n- [${timestamp}] ${correction.slice(0, 500)}\n`;

      // Check if AGENTS.md has a "## Learned Corrections" section
      if (!existing.includes('## Learned Corrections')) {
        const header = '\n\n## Learned Corrections\n';
        await writeFile(filePath, existing + header + entry, 'utf-8');
      } else {
        await writeFile(filePath, existing + entry, 'utf-8');
      }

      logger.debug(`Learning-first: persisted correction to ${filePath}`);
    } catch (err) {
      logger.debug(`Learning-first: failed to persist correction: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Get the number of unique corrections tracked this session. */
  getCorrectionCount(): number {
    return this.seenCorrections.size;
  }

  /** Reset tracked corrections (e.g., on new session). */
  resetCorrections(): void {
    this.seenCorrections.clear();
    this.errorPatterns.clear();
    this.autoLessonsCreated = 0;
  }

  /** Get count of auto-lessons created this session. */
  getAutoLessonCount(): number {
    return this.autoLessonsCreated;
  }

  /** Get current error pattern counts. */
  getErrorPatterns(): Map<string, number> {
    return new Map(this.errorPatterns);
  }

  /** Get configuration. */
  getConfig(): LearningFirstConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating the learning-first middleware.
 */
export function createLearningFirstMiddleware(
  config?: Partial<LearningFirstConfig>,
): LearningFirstMiddleware {
  return new LearningFirstMiddleware(config);
}
