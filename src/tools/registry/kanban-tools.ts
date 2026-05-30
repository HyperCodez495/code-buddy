import type { ToolResult } from '../../types/index.js';
import {
  KANBAN_BLOCK_TOOL,
  KANBAN_COMMENT_TOOL,
  KANBAN_COMPLETE_TOOL,
  KANBAN_CREATE_TOOL,
  KANBAN_HEARTBEAT_TOOL,
  KANBAN_LINK_TOOL,
  KANBAN_LIST_TOOL,
  KANBAN_SHOW_TOOL,
  KANBAN_UNBLOCK_TOOL,
} from '../../codebuddy/tool-definitions/kanban-tools.js';
import {
  KanbanStore,
  type CreateKanbanCardInput,
  type KanbanPriority,
  type KanbanStatus,
  type KanbanStoreOptions,
  type ListKanbanCardsFilter,
} from '../../kanban/kanban-store.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

type KanbanToolDefinition = typeof KANBAN_CREATE_TOOL;
type KanbanToolExecutor = (
  store: KanbanStore,
  input: Record<string, unknown>,
) => Promise<unknown>;

export type KanbanToolOptions = KanbanStoreOptions;

class KanbanTool implements ITool {
  readonly name: string;
  readonly description: string;

  constructor(
    private readonly definition: KanbanToolDefinition,
    private readonly executor: KanbanToolExecutor,
    private readonly options: KanbanToolOptions = {},
  ) {
    this.name = definition.function.name;
    this.description = definition.function.description;
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const store = this.createStore(context);
      const payload = await this.executor(store, input);
      return jsonResult(payload);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.definition.function.parameters as ToolSchema['parameters'],
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
      category: 'planning' as ToolCategoryType,
      keywords: ['kanban', 'hermes', 'task', 'coordination', 'board', 'status', 'agent'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  private createStore(context?: IToolExecutionContext): KanbanStore {
    return new KanbanStore({
      ...this.options,
      rootDir: this.options.rootDir ?? context?.cwd,
    });
  }
}

export function createKanbanTools(options: KanbanToolOptions = {}): ITool[] {
  return [
    new KanbanTool(KANBAN_SHOW_TOOL, async (store, input) => ({
      action: 'kanban_show',
      boardPath: store.path,
      card: await store.showCard(requiredString(input, 'id')),
    }), options),
    new KanbanTool(KANBAN_LIST_TOOL, async (store, input) => {
      const cards = await store.listCards(parseListFilter(input));
      return {
        action: 'kanban_list',
        boardPath: store.path,
        count: cards.length,
        cards,
      };
    }, options),
    new KanbanTool(KANBAN_COMPLETE_TOOL, async (store, input) => ({
      action: 'kanban_complete',
      boardPath: store.path,
      card: await store.completeCard(
        requiredString(input, 'id'),
        optionalString(input, 'comment'),
        optionalString(input, 'author'),
      ),
    }), options),
    new KanbanTool(KANBAN_BLOCK_TOOL, async (store, input) => ({
      action: 'kanban_block',
      boardPath: store.path,
      card: await store.blockCard(
        requiredString(input, 'id'),
        requiredString(input, 'reason'),
        optionalString(input, 'author'),
      ),
    }), options),
    new KanbanTool(KANBAN_HEARTBEAT_TOOL, async (store, input) => ({
      action: 'kanban_heartbeat',
      boardPath: store.path,
      card: await store.heartbeatCard(
        requiredString(input, 'id'),
        optionalString(input, 'message'),
        optionalString(input, 'author'),
      ),
    }), options),
    new KanbanTool(KANBAN_COMMENT_TOOL, async (store, input) => ({
      action: 'kanban_comment',
      boardPath: store.path,
      card: await store.commentCard(
        requiredString(input, 'id'),
        requiredString(input, 'text'),
        optionalString(input, 'author'),
      ),
    }), options),
    new KanbanTool(KANBAN_CREATE_TOOL, async (store, input) => ({
      action: 'kanban_create',
      boardPath: store.path,
      card: await store.createCard(parseCreateInput(input)),
    }), options),
    new KanbanTool(KANBAN_LINK_TOOL, async (store, input) => ({
      action: 'kanban_link',
      boardPath: store.path,
      card: await store.linkCard(
        requiredString(input, 'id'),
        requiredString(input, 'target'),
        optionalString(input, 'label'),
      ),
    }), options),
    new KanbanTool(KANBAN_UNBLOCK_TOOL, async (store, input) => ({
      action: 'kanban_unblock',
      boardPath: store.path,
      card: await store.unblockCard(
        requiredString(input, 'id'),
        optionalString(input, 'comment'),
        optionalString(input, 'author'),
      ),
    }), options),
  ];
}

function parseCreateInput(input: Record<string, unknown>): CreateKanbanCardInput {
  const status = optionalStatus(input, 'status');
  const priority = optionalPriority(input, 'priority');
  return {
    title: requiredString(input, 'title'),
    ...(optionalString(input, 'id') ? { id: optionalString(input, 'id') } : {}),
    ...(optionalString(input, 'description') ? { description: optionalString(input, 'description') } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(optionalString(input, 'assignee') ? { assignee: optionalString(input, 'assignee') } : {}),
    tags: parseTags(input.tags),
  };
}

function parseListFilter(input: Record<string, unknown>): ListKanbanCardsFilter {
  const status = optionalStatus(input, 'status');
  const priority = optionalPriority(input, 'priority');
  return {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(optionalString(input, 'assignee') ? { assignee: optionalString(input, 'assignee') } : {}),
    ...(optionalString(input, 'tag') ? { tag: optionalString(input, 'tag') } : {}),
    ...(typeof input.include_done === 'boolean' ? { includeDone: input.include_done } : {}),
  };
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalStatus(input: Record<string, unknown>, key: string): KanbanStatus | undefined {
  const value = optionalString(input, key);
  if (!value) return undefined;
  if (isKanbanStatus(value)) return value;
  throw new Error(`${key} must be one of: todo, in_progress, blocked, done`);
}

function optionalPriority(input: Record<string, unknown>, key: string): KanbanPriority | undefined {
  const value = optionalString(input, key);
  if (!value) return undefined;
  if (isKanbanPriority(value)) return value;
  throw new Error(`${key} must be one of: low, medium, high, urgent`);
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function isKanbanStatus(value: string): value is KanbanStatus {
  return value === 'todo' || value === 'in_progress' || value === 'blocked' || value === 'done';
}

function isKanbanPriority(value: string): value is KanbanPriority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';
}

function jsonResult(payload: unknown): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}
