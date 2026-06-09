/**
 * Screenpipe Tool Adapter — `screen_memory`.
 *
 * ITool-compliant adapter that queries a local screenpipe instance
 * (https://github.com/mediar-ai/screenpipe) so the agent can recall what was on
 * screen / said / heard. Read-only; results are secret/PII-redacted via the
 * fleet privacy-lint before they reach the model. Needs screenpipe running
 * locally (SCREENPIPE_URL, default http://localhost:3030).
 */
import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  ScreenpipeClient,
  type ScreenpipeContentType,
  type ScreenpipeItem,
} from '../../integrations/screenpipe/screenpipe-client.js';
import { redactSecrets } from '../../capture/screen-watcher.js';

const CONTENT_TYPES: ScreenpipeContentType[] = ['all', 'ocr', 'audio', 'ui'];

function formatItem(item: ScreenpipeItem): string {
  const where = [item.appName, item.windowName].filter(Boolean).join(' › ');
  const when = item.timestamp ? ` @ ${item.timestamp}` : '';
  const text = item.text ? redactSecrets(item.text).text.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  return `- [${item.type}] ${where}${when}${text ? `: ${text}` : ''}`;
}

export class ScreenMemoryTool implements ITool {
  readonly name = 'screen_memory';
  readonly description =
    'Recall what was on your screen, said, or heard by querying a local screenpipe instance (24/7 screen+audio history). Read-only; results are secret/PII-redacted. Requires screenpipe running locally.';

  private readonly clientFactory: () => ScreenpipeClient;

  constructor(clientFactory: () => ScreenpipeClient = () => new ScreenpipeClient()) {
    this.clientFactory = clientFactory;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof input['query'] === 'string' ? (input['query'] as string) : undefined;
    const contentType = CONTENT_TYPES.includes(input['content_type'] as ScreenpipeContentType)
      ? (input['content_type'] as ScreenpipeContentType)
      : 'all';
    const limit = typeof input['limit'] === 'number' ? Math.min(50, Math.max(1, input['limit'] as number)) : 10;
    const client = this.clientFactory();

    try {
      if (!(await client.health())) {
        return {
          success: false,
          error: `screenpipe is not reachable at ${client.baseUrl}. Start it (https://github.com/mediar-ai/screenpipe) or set SCREENPIPE_URL.`,
        };
      }
      const result = await client.search({
        contentType,
        limit,
        ...(query ? { query } : {}),
        ...(typeof input['app_name'] === 'string' ? { appName: input['app_name'] as string } : {}),
        ...(typeof input['window_name'] === 'string' ? { windowName: input['window_name'] as string } : {}),
        ...(typeof input['start_time'] === 'string' ? { startTime: input['start_time'] as string } : {}),
        ...(typeof input['end_time'] === 'string' ? { endTime: input['end_time'] as string } : {}),
      });
      if (result.items.length === 0) {
        return { success: true, output: `No screen memory matched${query ? ` "${query}"` : ''}.` };
      }
      const header = `${result.items.length} of ${result.total} result(s)${query ? ` for "${query}"` : ''} (redacted):`;
      return { success: true, output: `${header}\n${result.items.map(formatItem).join('\n')}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language search over screen+audio history (omit for most recent).' },
          content_type: { type: 'string', enum: CONTENT_TYPES, description: 'all (default), ocr (screen text), audio (transcripts), or ui.' },
          limit: { type: 'number', description: 'Max results, 1–50 (default 10).' },
          app_name: { type: 'string', description: 'Filter by application name.' },
          window_name: { type: 'string', description: 'Filter by window title.' },
          start_time: { type: 'string', description: 'ISO-8601 start of time range.' },
          end_time: { type: 'string', description: 'ISO-8601 end of time range.' },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['screen', 'memory', 'screenpipe', 'recall', 'what did i see', 'history', 'ocr', 'audio', 'transcript', 'said', 'heard'],
      priority: 5,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createScreenpipeTools(): ITool[] {
  return [new ScreenMemoryTool()];
}

export function resetScreenpipeInstances(): void {
  // Stateless tool — nothing to reset
}
