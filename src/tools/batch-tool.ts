/**
 * Batch Tool
 *
 * Executes multiple read-only tool calls in parallel using Promise.allSettled().
 * Blocks destructive tools unless YOLO mode is active.
 * Prevents recursive batch calls.
 */

import { logger } from '../utils/logger.js';

/**
 * Tools that are safe to run in parallel (read-only)
 */
export const READ_ONLY_TOOLS = new Set([
  'view_file',
  'search',
  'grep',
  'glob',
  'list_files',
  'list_directory',
  'find_symbols',
  'find_references',
  'find_definition',
  'web_search',
  'codebase_map',
  'code_graph',
  'docs_search',
  'search_multi',
]);

/**
 * Tools that are explicitly destructive and blocked in non-YOLO batch mode
 */
const DESTRUCTIVE_TOOLS = new Set([
  'bash',
  'apply_patch',
  'create_file',
  'str_replace_editor',
  'edit_file',
  'multi_edit',
  'codebase_replace',
  'run_script',
]);

/**
 * Maximum number of tool calls in a single batch
 */
export const MAX_BATCH_SIZE = 25;

export interface BatchCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface BatchResult {
  tool: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface BatchExecutionResult {
  results: BatchResult[];
  summary: string;
  totalDurationMs: number;
}

type ExecuteToolFn = (toolName: string, args: Record<string, unknown>) => Promise<{ success: boolean; output?: string; error?: string }>;

/**
 * Execute a batch of tool calls in parallel.
 *
 * @param calls - Array of tool call specifications
 * @param executeTool - Function to execute individual tools
 * @param yoloMode - Whether YOLO mode is active (allows destructive tools)
 * @returns Batch execution results with summary
 */
export async function executeBatch(
  calls: BatchCall[],
  executeTool: ExecuteToolFn,
  yoloMode: boolean = false,
): Promise<BatchExecutionResult> {
  // Validate batch size
  if (calls.length === 0) {
    return {
      results: [],
      summary: 'Empty batch — no tools to execute.',
      totalDurationMs: 0,
    };
  }

  if (calls.length > MAX_BATCH_SIZE) {
    return {
      results: [],
      summary: `Batch too large: ${calls.length} calls exceeds maximum of ${MAX_BATCH_SIZE}.`,
      totalDurationMs: 0,
    };
  }

  // Block recursive batch calls
  const hasBatchCall = calls.some(c => c.tool === 'batch' || c.tool === 'batch_tools');
  if (hasBatchCall) {
    return {
      results: [],
      summary: 'Recursive batch calls are not allowed.',
      totalDurationMs: 0,
    };
  }

  // Block destructive tools in non-YOLO mode
  if (!yoloMode) {
    const blockedCalls = calls.filter(c => DESTRUCTIVE_TOOLS.has(c.tool));
    if (blockedCalls.length > 0) {
      const blockedNames = [...new Set(blockedCalls.map(c => c.tool))].join(', ');
      return {
        results: [],
        summary: `Destructive tools blocked in batch mode: ${blockedNames}. Enable YOLO mode (/yolo on) to use destructive tools in batches.`,
        totalDurationMs: 0,
      };
    }
  }

  const batchStart = Date.now();

  logger.debug(`Executing batch of ${calls.length} tool calls`);

  // Execute all calls in parallel
  const promises = calls.map(async (call, index): Promise<BatchResult> => {
    const callStart = Date.now();
    try {
      const result = await executeTool(call.tool, call.args);
      return {
        tool: call.tool,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: Date.now() - callStart,
      };
    } catch (error: unknown) {
      return {
        tool: call.tool,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - callStart,
      };
    }
  });

  const settled = await Promise.allSettled(promises);

  const results: BatchResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Rejected promise (shouldn't happen since we catch errors above)
    return {
      tool: calls[index]?.tool ?? 'unknown',
      success: false,
      error: result.reason?.message || String(result.reason),
      durationMs: 0,
    };
  });

  const totalDurationMs = Date.now() - batchStart;
  const succeeded = results.filter(r => r.success).length;
  const failed = results.length - succeeded;

  const summary = `Batch complete: ${succeeded}/${results.length} succeeded${failed > 0 ? `, ${failed} failed` : ''} in ${totalDurationMs}ms`;

  logger.debug(summary);

  return {
    results,
    summary,
    totalDurationMs,
  };
}

/**
 * Format batch results for display
 */
export function formatBatchResults(result: BatchExecutionResult): string {
  const lines: string[] = [result.summary, ''];

  for (const r of result.results) {
    const status = r.success ? '[OK]' : '[FAIL]';
    const duration = `${r.durationMs}ms`;
    lines.push(`${status} ${r.tool} (${duration})`);

    if (r.error) {
      lines.push(`  Error: ${r.error}`);
    }

    if (r.output) {
      // Truncate long output
      const maxLen = 500;
      const truncated = r.output.length > maxLen
        ? r.output.slice(0, maxLen) + `\n  ... (${r.output.length - maxLen} more chars)`
        : r.output;
      lines.push(`  ${truncated.replace(/\n/g, '\n  ')}`);
    }
  }

  return lines.join('\n');
}
