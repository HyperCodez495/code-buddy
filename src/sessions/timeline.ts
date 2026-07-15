import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';

export interface TimelineToolCall {
  name: string;
  ok: boolean;
}

export interface TimelineEntry {
  turn: number;
  ts: string;
  role: 'user' | 'assistant';
  textPreview: string;
  toolCalls: TimelineToolCall[];
  filesTouched: string[];
  checkpointId?: string;
}

export interface SessionTimelineOptions {
  sessionId?: string;
  directory?: string;
}

const MAX_PREVIEW_LENGTH = 400;

function isTimelineEntry(value: unknown): value is TimelineEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.turn) &&
    typeof entry.turn === 'number' &&
    entry.turn > 0 &&
    typeof entry.ts === 'string' &&
    (entry.role === 'user' || entry.role === 'assistant') &&
    typeof entry.textPreview === 'string' &&
    Array.isArray(entry.toolCalls) &&
    entry.toolCalls.every((call) => {
      if (!call || typeof call !== 'object') return false;
      const candidate = call as Record<string, unknown>;
      return typeof candidate.name === 'string' && typeof candidate.ok === 'boolean';
    }) &&
    Array.isArray(entry.filesTouched) &&
    entry.filesTouched.every((file) => typeof file === 'string') &&
    (entry.checkpointId === undefined || typeof entry.checkpointId === 'string')
  );
}

/**
 * Append-only, preview-only timeline for one or more persisted sessions.
 *
 * Every public operation is best-effort: timeline storage must never break an
 * agent turn or a replay inspection command.
 */
export class SessionTimeline {
  private readonly sessionId?: string;
  private readonly directory: string;

  constructor(options?: SessionTimelineOptions);
  constructor(sessionId?: string, options?: Omit<SessionTimelineOptions, 'sessionId'>);
  constructor(
    sessionIdOrOptions: string | SessionTimelineOptions = {},
    options: Omit<SessionTimelineOptions, 'sessionId'> = {},
  ) {
    if (typeof sessionIdOrOptions === 'string') {
      this.sessionId = sessionIdOrOptions;
      this.directory = options.directory ?? path.join(os.homedir(), '.codebuddy', 'timelines');
    } else {
      this.sessionId = sessionIdOrOptions.sessionId;
      this.directory = sessionIdOrOptions.directory ?? path.join(os.homedir(), '.codebuddy', 'timelines');
    }
  }

  async record(entry: TimelineEntry): Promise<void> {
    if (!this.sessionId) {
      logger.warn('[session-timeline] cannot record without a session id');
      return;
    }

    try {
      await fs.mkdir(this.directory, { recursive: true });
      const normalized: TimelineEntry = {
        ...entry,
        textPreview: entry.textPreview.slice(0, MAX_PREVIEW_LENGTH),
        toolCalls: entry.toolCalls.map((call) => ({ name: call.name, ok: call.ok })),
        filesTouched: [...new Set(entry.filesTouched)],
      };
      await fs.appendFile(this.filePath(this.sessionId), `${JSON.stringify(normalized)}\n`, {
        encoding: 'utf8',
        flag: 'a',
      });
    } catch (error) {
      logger.warn('[session-timeline] failed to append timeline entry', {
        sessionId: this.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(sessionId: string): Promise<TimelineEntry[]> {
    try {
      const raw = await fs.readFile(this.filePath(sessionId), 'utf8');
      const entries: TimelineEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isTimelineEntry(parsed)) entries.push(parsed);
          else logger.warn('[session-timeline] ignored invalid timeline entry', { sessionId });
        } catch (error) {
          logger.warn('[session-timeline] ignored malformed timeline entry', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return entries.sort((left, right) => left.turn - right.turn);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (code !== 'ENOENT') {
        logger.warn('[session-timeline] failed to read timeline', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    }
  }

  async get(sessionId: string, turn: number): Promise<TimelineEntry | undefined> {
    const entries = await this.list(sessionId);
    return entries.find((entry) => entry.turn === turn);
  }

  private filePath(sessionId: string): string {
    return path.join(this.directory, `${encodeURIComponent(sessionId)}.jsonl`);
  }
}
