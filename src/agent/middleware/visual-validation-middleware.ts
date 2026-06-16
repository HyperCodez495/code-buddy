/**
 * Visual Validation Middleware
 *
 * Checks if the agent has saved an Office document (Excel, PowerPoint, Word).
 * If so, it warns the agent to consider running a visual validation step
 * using `snapshot_with_screenshot` to verify the layout, fonts, and alignments.
 *
 * Priority 156
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

export class VisualValidationMiddleware implements ConversationMiddleware {
  readonly name = 'visual-validation';
  readonly priority = 156;

  private hasWarnedForFiles = new Set<string>();

  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (process.platform !== 'win32') {
      return { action: 'continue' };
    }

    const savedFiles = this.getRecentlySavedOfficeFiles(context);
    if (savedFiles.length === 0) {
      return { action: 'continue' };
    }

    // Filter out files we already warned about
    const newFiles = savedFiles.filter((f) => !this.hasWarnedForFiles.has(f));
    if (newFiles.length === 0) {
      return { action: 'continue' };
    }

    for (const f of newFiles) {
      this.hasWarnedForFiles.add(f);
    }

    logger.info('Visual validation middleware triggered', {
      files: newFiles,
    });

    return {
      action: 'warn',
      message:
        `You just saved the following Office document(s): ${newFiles.join(', ')}.\n` +
        `To ensure the best quality, please open the document and use the \`snapshot_with_screenshot\` action via \`computer_control\` to visually verify the layout, fonts, and alignment, and auto-correct any visual issues.`,
    };
  }

  private getRecentlySavedOfficeFiles(context: MiddlewareContext): string[] {
    const files = new Set<string>();
    
    // Scan recent tool calls in the context history
    for (let i = context.history.length - 1; i >= Math.max(0, context.history.length - 10); i--) {
      const msg = context.history[i];
      if (!msg || !msg.toolCalls) continue;

      for (const call of msg.toolCalls) {
        if (call.function.name === 'computer_control') {
          try {
            const args = JSON.parse(call.function.arguments);
            const action = args.action;
            if (['excel_save_workbook', 'powerpoint_save_presentation', 'word_save_document'].includes(action)) {
               if (args.saveAsPath || args.filePath) {
                 files.add(args.saveAsPath || args.filePath);
               }
            }
          } catch {
             // Ignore parse errors
          }
        }
      }
    }
    
    return Array.from(files);
  }
}
