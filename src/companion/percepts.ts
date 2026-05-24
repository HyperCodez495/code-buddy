import { appendFile, mkdir, readFile, stat } from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';

export type CompanionPerceptModality =
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'self'
  | 'memory'
  | 'tool'
  | 'suggestion';

export interface CompanionPercept<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  modality: CompanionPerceptModality;
  source: string;
  timestamp: string;
  confidence: number;
  summary: string;
  payload: TPayload;
  tags: string[];
}

export interface CompanionPerceptInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  modality: CompanionPerceptModality;
  source: string;
  summary: string;
  payload?: TPayload;
  confidence?: number;
  tags?: string[];
}

export interface CompanionPerceptStoreOptions {
  cwd?: string;
  storePath?: string;
  now?: Date;
}

export interface CompanionPerceptQueryOptions {
  cwd?: string;
  storePath?: string;
  limit?: number;
  modality?: CompanionPerceptModality;
}

export interface CompanionPerceptStats {
  storePath: string;
  exists: boolean;
  total: number;
  byModality: Partial<Record<CompanionPerceptModality, number>>;
  latestTimestamp?: string;
}

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 100;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionPerceptsPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'percepts.jsonl');
}

function resolveStorePath(options: CompanionPerceptStoreOptions = {}): string {
  return path.resolve(resolveCwd(options.cwd), options.storePath || getCompanionPerceptsPath(resolveCwd(options.cwd)));
}

function normalizeConfidence(confidence: number | undefined): number {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return 1;
  return Math.max(0, Math.min(1, confidence));
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

function createPerceptId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `percept-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function parsePercept(line: string): CompanionPercept | null {
  try {
    const parsed = JSON.parse(line) as Partial<CompanionPercept>;
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.modality !== 'string'
      || typeof parsed.source !== 'string'
      || typeof parsed.timestamp !== 'string'
      || typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    return {
      id: parsed.id,
      modality: parsed.modality as CompanionPerceptModality,
      source: parsed.source,
      timestamp: parsed.timestamp,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1,
      summary: parsed.summary,
      payload: typeof parsed.payload === 'object' && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : {},
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  } catch {
    return null;
  }
}

export async function recordCompanionPercept<TPayload extends Record<string, unknown>>(
  input: CompanionPerceptInput<TPayload>,
  options: CompanionPerceptStoreOptions = {},
): Promise<CompanionPercept<TPayload>> {
  const now = options.now || new Date();
  const storePath = resolveStorePath(options);
  const percept: CompanionPercept<TPayload> = {
    id: createPerceptId(now),
    modality: input.modality,
    source: input.source,
    timestamp: now.toISOString(),
    confidence: normalizeConfidence(input.confidence),
    summary: input.summary.trim(),
    payload: input.payload || {} as TPayload,
    tags: normalizeTags(input.tags),
  };

  await mkdir(path.dirname(storePath), { recursive: true });
  await appendFile(storePath, `${JSON.stringify(percept)}\n`, 'utf8');
  return percept;
}

export async function readRecentCompanionPercepts(
  options: CompanionPerceptQueryOptions = {},
): Promise<CompanionPercept[]> {
  const storePath = resolveStorePath(options);
  const limit = Math.max(1, Math.min(MAX_RECENT_LIMIT, options.limit || DEFAULT_RECENT_LIMIT));

  let content: string;
  try {
    content = await readFile(storePath, 'utf8');
  } catch {
    return [];
  }

  const matches = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePercept)
    .filter((percept): percept is CompanionPercept => Boolean(percept))
    .filter(percept => !options.modality || percept.modality === options.modality);

  return matches.slice(-limit).reverse();
}

export async function getCompanionPerceptStats(
  options: CompanionPerceptStoreOptions = {},
): Promise<CompanionPerceptStats> {
  const storePath = resolveStorePath(options);

  try {
    const info = await stat(storePath);
    if (!info.isFile()) {
      return { storePath, exists: false, total: 0, byModality: {} };
    }
  } catch {
    return { storePath, exists: false, total: 0, byModality: {} };
  }

  const content = await readFile(storePath, 'utf8');
  const percepts = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePercept)
    .filter((percept): percept is CompanionPercept => Boolean(percept));

  const byModality: Partial<Record<CompanionPerceptModality, number>> = {};
  for (const percept of percepts) {
    byModality[percept.modality] = (byModality[percept.modality] || 0) + 1;
  }

  return {
    storePath,
    exists: true,
    total: percepts.length,
    byModality,
    latestTimestamp: percepts.at(-1)?.timestamp,
  };
}

export function formatCompanionPercepts(percepts: CompanionPercept[]): string {
  if (percepts.length === 0) {
    return 'No companion percepts recorded yet.';
  }

  const lines = ['Recent Companion Percepts', '='.repeat(50)];
  for (const percept of percepts) {
    const tags = percept.tags.length > 0 ? ` [${percept.tags.join(', ')}]` : '';
    lines.push(
      '',
      `${percept.timestamp} ${percept.modality}/${percept.source}${tags}`,
      `  ${percept.summary}`,
      `  id=${percept.id} confidence=${percept.confidence.toFixed(2)}`,
    );
  }
  return lines.join('\n');
}

export function formatCompanionPerceptStats(stats: CompanionPerceptStats): string {
  const lines = [
    'Companion Percept Store',
    '='.repeat(50),
    `Path: ${stats.storePath}`,
    `Exists: ${stats.exists ? 'yes' : 'no'}`,
    `Total: ${stats.total}`,
  ];

  const modalities = Object.entries(stats.byModality);
  if (modalities.length > 0) {
    lines.push('By modality:');
    for (const [modality, count] of modalities) {
      lines.push(`- ${modality}: ${count}`);
    }
  }
  if (stats.latestTimestamp) {
    lines.push(`Latest: ${stats.latestTimestamp}`);
  }

  return lines.join('\n');
}
