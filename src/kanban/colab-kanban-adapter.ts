/**
 * ColabKanbanAdapter — the unification seam (Hermes/OpenClaw parity).
 *
 * Exposes the subset of the {@link KanbanStore} API that the `kanban_*` tools
 * use, but backed by {@link FleetColabStore} so the agent's kanban tools and the
 * autonomous daemon drive ONE shared board (`.codebuddy/colab-tasks.json`)
 * instead of two disconnected files. A card created with `kanban_create` is now
 * claimable by the daemon; a task the daemon completes shows up in `kanban_list`.
 *
 * The output keeps the {@link KanbanCard} shape (so the tool contract is stable),
 * with a faithful status/priority mapping. Crucially `urgent ↔ critical`, so a
 * card marked `urgent` becomes a `critical` colab task — which
 * {@link FleetColabStore.isAutoClaimable} refuses to auto-claim. That is the
 * intended safety carry-over: urgent work needs human eyes, it is not silently
 * grabbed by the daemon.
 *
 * Free-form `kanban_link` references (PRs/commits/files) are kept as free-form
 * links — they are NOT folded into the `dependsOn` DAG (which stays a distinct,
 * task-id-only concept surfaced via `buddy autonomy tasks link`).
 *
 * The richer multi-board surface (board registry, assign, archive, unlink, stats)
 * stays on {@link KanbanStore} / the `hermes kanban` CLI — those are not exposed
 * as the 9 `kanban_*` tools, so they are intentionally out of this adapter.
 */
import * as path from 'path';
import {
  FleetColabStore,
  type ColabTask,
  type ColabTaskPriority,
  type ColabTaskStatus,
  type FleetColabStoreConfig,
} from '../fleet/colab-store.js';
import type {
  CreateKanbanCardInput,
  KanbanCard,
  KanbanPriority,
  KanbanStatus,
  KanbanStoreOptions,
  ListKanbanCardsFilter,
} from './kanban-store.js';

const STATUS_TO_KANBAN: Record<ColabTaskStatus, KanbanStatus> = {
  open: 'todo',
  in_progress: 'in_progress',
  completed: 'done',
  blocked: 'blocked',
};
const STATUS_TO_COLAB: Record<KanbanStatus, ColabTaskStatus> = {
  todo: 'open',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'completed',
  archived: 'open', // archived has no colab equivalent; treat as open (archive lives on KanbanStore)
};
const PRIORITY_TO_KANBAN: Record<ColabTaskPriority, KanbanPriority> = {
  critical: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
};
const PRIORITY_TO_COLAB: Record<KanbanPriority, ColabTaskPriority> = {
  urgent: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export class ColabKanbanAdapter {
  private readonly store: FleetColabStore;
  private readonly createId: (() => string) | undefined;

  constructor(options: KanbanStoreOptions = {}) {
    const rootDir = options.rootDir ?? process.cwd();
    const config: FleetColabStoreConfig = { dir: path.join(rootDir, '.codebuddy') };
    if (options.now) {
      const toDate = options.now;
      config.now = () => toDate().getTime();
    }
    this.createId = options.createId;
    if (options.createId) {
      const make = options.createId;
      config.generateId = (prefix: string) => `${prefix}-${make()}`;
    }
    this.store = new FleetColabStore(config);
  }

  /** The shared board file — now colab-tasks.json, not kanban-board.json. */
  get path(): string {
    return path.join(this.store.getDir(), 'colab-tasks.json');
  }

  async createCard(input: CreateKanbanCardInput): Promise<KanbanCard> {
    const title = input.title.trim();
    if (!title) throw new Error('title is required');
    const task = this.store.addTask({
      title,
      ...(input.id?.trim() ? { id: input.id.trim() } : { id: this.buildCardId(title) }),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.status ? { status: STATUS_TO_COLAB[input.status] } : {}),
      ...(input.priority ? { priority: PRIORITY_TO_COLAB[input.priority] } : {}),
      ...(input.assignee?.trim() ? { assignee: input.assignee.trim() } : {}),
      ...(input.tags && input.tags.length > 0 ? { tags: normalizeTags(input.tags) } : {}),
    });
    return toKanbanCard(task);
  }

  async listCards(filter: ListKanbanCardsFilter = {}): Promise<KanbanCard[]> {
    const includeDone = filter.includeDone !== false;
    const includeArchived = filter.includeArchived === true || filter.status === 'archived';
    return this.store
      .listTasks()
      .map(toKanbanCard)
      .filter((card) => {
        if (!includeDone && card.status === 'done') return false;
        if (!includeArchived && card.status === 'archived') return false;
        if (filter.status && card.status !== filter.status) return false;
        if (filter.priority && card.priority !== filter.priority) return false;
        if (filter.assignee && card.assignee !== filter.assignee) return false;
        if (filter.tag && !card.tags.includes(filter.tag)) return false;
        return true;
      })
      .sort(compareCards);
  }

  async showCard(id: string): Promise<KanbanCard> {
    return toKanbanCard(this.getOrThrow(id));
  }

  async completeCard(id: string, comment?: string, author?: string): Promise<KanbanCard> {
    this.getOrThrow(id);
    this.store.completeTask(id, { summary: comment?.trim() || 'Completed', ...(author ? { agentId: author } : {}) });
    if (comment?.trim()) this.store.addComment(id, comment, author);
    return toKanbanCard(this.getOrThrow(id));
  }

  async blockCard(id: string, reason: string, author?: string): Promise<KanbanCard> {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error('reason is required');
    this.store.blockTask(id, trimmed);
    this.store.addComment(id, `Blocked: ${trimmed}`, author);
    return toKanbanCard(this.getOrThrow(id));
  }

  async unblockCard(id: string, comment?: string, author?: string): Promise<KanbanCard> {
    return toKanbanCard(this.store.unblockTask(id, comment, author));
  }

  async commentCard(id: string, text: string, author?: string): Promise<KanbanCard> {
    return toKanbanCard(this.store.addComment(id, text, author));
  }

  async heartbeatCard(id: string, message?: string, author?: string): Promise<KanbanCard> {
    return toKanbanCard(this.store.recordHeartbeat(id, message, author, author));
  }

  async linkCard(id: string, target: string, label?: string): Promise<KanbanCard> {
    return toKanbanCard(this.store.addLink(id, target, label));
  }

  private getOrThrow(id: string): ColabTask {
    const task = this.store.getTask(id.trim());
    if (!task) throw new Error(`kanban card not found: ${id}`);
    return task;
  }

  private buildCardId(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'card';
    const raw = this.createId ? this.createId() : `${process.pid}${process.hrtime.bigint()}`;
    const suffix = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'card';
    return `kb-${slug}-${suffix}`;
  }
}

/**
 * Migrate cards from a legacy `kanban-board.json` (read as {@link KanbanCard}s)
 * into the unified fleet board. Idempotent: a card whose id already exists is
 * skipped, as are archived cards (colab has no archived state). Comments and
 * free-form links are carried over; ephemeral heartbeats are not. Returns the
 * imported / skipped ids so a CLI can report the migration.
 */
export function importKanbanCards(
  cards: KanbanCard[],
  store: FleetColabStore,
): { imported: string[]; skipped: string[] } {
  const imported: string[] = [];
  const skipped: string[] = [];
  const existing = new Set(store.listTasks().map((t) => t.id));
  for (const card of cards) {
    if (card.status === 'archived' || existing.has(card.id)) {
      skipped.push(card.id);
      continue;
    }
    store.addTask({
      id: card.id,
      title: card.title,
      status: STATUS_TO_COLAB[card.status],
      priority: PRIORITY_TO_COLAB[card.priority],
      ...(card.description ? { description: card.description } : {}),
      ...(card.tags.length > 0 ? { tags: card.tags } : {}),
      ...(card.assignee ? { assignee: card.assignee } : {}),
    });
    for (const c of card.comments) store.addComment(card.id, c.text, c.author);
    for (const l of card.links) store.addLink(card.id, l.target, l.label);
    imported.push(card.id);
  }
  return { imported, skipped };
}

function toKanbanCard(task: ColabTask): KanbanCard {
  const createdAt = task.createdAt ?? task.claimedAt ?? new Date(0).toISOString();
  const updatedAt =
    task.completedAt ?? task.lastHeartbeatAt ?? task.claimedAt ?? task.createdAt ?? createdAt;
  return {
    id: task.id,
    title: task.title,
    status: STATUS_TO_KANBAN[task.status],
    priority: PRIORITY_TO_KANBAN[task.priority],
    tags: normalizeTags(task.tags ?? []),
    links: (task.links ?? []).map((l) => ({
      id: l.id,
      target: l.target,
      createdAt: l.createdAt,
      ...(l.label ? { label: l.label } : {}),
    })),
    comments: (task.comments ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      ...(c.author ? { author: c.author } : {}),
    })),
    heartbeats: (task.heartbeats ?? []).map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      ...(h.message ? { message: h.message } : {}),
      ...(h.author ? { author: h.author } : {}),
    })),
    createdAt,
    updatedAt,
    ...(task.description ? { description: task.description } : {}),
    ...(task.assignee ? { assignee: task.assignee } : {}),
    ...(task.blockedReason ? { blockedReason: task.blockedReason } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  };
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function compareCards(a: KanbanCard, b: KanbanCard): number {
  const statusOrder: Record<KanbanStatus, number> = { blocked: 0, in_progress: 1, todo: 2, done: 3, archived: 4 };
  const priorityOrder: Record<KanbanPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    priorityOrder[a.priority] - priorityOrder[b.priority] ||
    a.createdAt.localeCompare(b.createdAt)
  );
}
