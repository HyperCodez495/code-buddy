/**
 * Skill Enhancements
 *
 * SkillVariableResolver: replaces template variables ($ARGUMENTS, $WORKING_DIR, etc.)
 * SkillBudgetCalculator: computes char budgets for skill content injection
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SkillContext {
  arguments?: string[];
  sessionId?: string;
  workingDir?: string;
  gitBranch?: string;
}

// ============================================================================
// SkillVariableResolver
// ============================================================================

export class SkillVariableResolver {
  /**
   * Parse indexed argument reference like $ARGUMENTS[0]
   * Returns the index or -1 if not an indexed reference
   */
  parseIndexedArgument(varRef: string): number {
    const match = varRef.match(/^\$ARGUMENTS\[(\d+)\]$/);
    const indexStr = match?.[1];
    if (indexStr !== undefined) {
      return parseInt(indexStr, 10);
    }
    return -1;
  }

  /**
   * Resolve template variables in a skill template string
   */
  resolve(template: string, context: SkillContext): string {
    let result = template;

    // Replace indexed arguments first: $ARGUMENTS[0], $ARGUMENTS[1], etc.
    result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, indexStr) => {
      const index = parseInt(indexStr, 10);
      const args = context.arguments || [];
      return index < args.length ? (args[index] ?? '') : '';
    });

    // Replace $ARGUMENTS with all arguments joined
    result = result.replace(/\$ARGUMENTS/g, (context.arguments || []).join(' '));

    // Replace other variables
    result = result.replace(/\$CLAUDE_SESSION_ID/g, context.sessionId || '');
    result = result.replace(/\$WORKING_DIR/g, context.workingDir || process.cwd());
    result = result.replace(/\$GIT_BRANCH/g, context.gitBranch || 'main');

    logger.debug('Skill variables resolved');
    return result;
  }
}

// ============================================================================
// SkillBudgetCalculator
// ============================================================================

export class SkillBudgetCalculator {
  /**
   * Calculate budget as 2% of context window size (in characters)
   */
  calculateBudget(contextWindowSize: number): number {
    return Math.floor(contextWindowSize * 0.02);
  }

  /**
   * Truncate content to fit within the character budget
   */
  truncateToLimit(content: string, budget: number): string {
    if (content.length <= budget) return content;
    return content.slice(0, budget - 3) + '...';
  }

  /**
   * Get default budget for 200k context window
   */
  getDefaultBudget(): number {
    return this.calculateBudget(200000);
  }
}
