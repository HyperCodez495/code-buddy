/**
 * Scheduled delivery helpers.
 *
 * Hermes Agent's cron can deliver a job's result "to any platform". Code
 * Buddy already has a rich channel layer (Telegram, Discord, Slack, email, …)
 * and `CronAgentBridge.deliverResult`, but delivery was limited to a single
 * channel string plus an optional webhook. These pure helpers add:
 *
 *   - multi-target fan-out: a scheduled job can name several `type:id` targets;
 *   - a mobile-safe `summary` format: title + status + a redacted, truncated
 *     body, so a push/DM never carries secrets or a full prompt (item 17).
 *
 * Pure and side-effect free: the bridge owns the actual channel sends.
 */

import { getDataRedactionEngine } from '../security/data-redaction.js';

export type ScheduledDeliveryFormat = 'full' | 'summary';

export interface ScheduledDeliveryConfig {
  /** Single channel spec, kept for backward compatibility. */
  channel?: string;
  /** Multiple `type:id` channel specs (e.g. `telegram:123`, `discord:456`). */
  targets?: string[];
  /** Body format: `full` (default) or mobile-safe `summary`. */
  format?: ScheduledDeliveryFormat;
}

export interface ParsedDeliveryTarget {
  /** Raw `type:id` (or `type`) spec as configured. */
  spec: string;
  /** Channel type, e.g. `telegram`. */
  channelType: string;
  /** Channel id, defaulting to `default` when the spec omits one. */
  channelId: string;
}

const DEFAULT_SUMMARY_MAX_CHARS = 800;

/**
 * Collect and de-duplicate channel targets from a delivery config. The legacy
 * single `channel` field and the new `targets[]` are merged; order is stable
 * (single channel first, then targets) and duplicates are dropped.
 */
export function collectDeliveryTargets(delivery: ScheduledDeliveryConfig | undefined): ParsedDeliveryTarget[] {
  if (!delivery) return [];
  const specs: string[] = [];
  if (typeof delivery.channel === 'string' && delivery.channel.trim().length > 0) {
    specs.push(delivery.channel.trim());
  }
  for (const target of delivery.targets ?? []) {
    if (typeof target === 'string' && target.trim().length > 0) {
      specs.push(target.trim());
    }
  }

  const seen = new Set<string>();
  const parsed: ParsedDeliveryTarget[] = [];
  for (const spec of specs) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    const [channelType, channelId] = spec.includes(':')
      ? splitFirst(spec, ':')
      : [spec, 'default'];
    if (channelType.length === 0) continue;
    parsed.push({ spec, channelType, channelId: channelId.length > 0 ? channelId : 'default' });
  }
  return parsed;
}

export interface ScheduledSummaryInput {
  jobName: string;
  /** High-level outcome label. */
  status: string;
  /** Raw job output to summarize. */
  output: string;
  /** Optional risk label surfaced in the header. */
  risk?: string;
  /** Body truncation budget (default 800 chars). */
  maxChars?: number;
}

export interface ScheduledSummaryResult {
  content: string;
  redactionCount: number;
  truncated: boolean;
}

/**
 * Build a mobile-safe delivery body: a compact header (job, status, optional
 * risk) plus a secrets-redacted, length-capped excerpt of the output. Never
 * includes the original prompt — only the produced output, redacted.
 */
export function formatScheduledSummary(input: ScheduledSummaryInput): ScheduledSummaryResult {
  const maxChars = normalizeMaxChars(input.maxChars);
  const redactor = getDataRedactionEngine();
  const redacted = redactor.redact(input.output ?? '');
  const redactionCount = redacted.redactions.length;

  let body = redacted.redacted.trim();
  let truncated = false;
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars).trimEnd()}\n… [truncated]`;
    truncated = true;
  }

  const header = [
    `Scheduled: ${input.jobName}`,
    `Status: ${input.status}`,
    ...(input.risk ? [`Risk: ${input.risk}`] : []),
  ].join(' | ');

  return {
    content: body.length > 0 ? `${header}\n\n${body}` : header,
    redactionCount,
    truncated,
  };
}

/**
 * Resolve the body a scheduled delivery should carry, honoring the configured
 * format. `summary` is mobile-safe (redacted + truncated); `full` is the raw
 * output, prefixed with the job name like the legacy delivery path.
 */
export function resolveDeliveryBody(input: {
  jobName: string;
  output: string;
  status: string;
  format: ScheduledDeliveryFormat | undefined;
  risk?: string;
  maxChars?: number;
}): { content: string; redactionCount: number } {
  if (input.format === 'summary') {
    const summary = formatScheduledSummary({
      jobName: input.jobName,
      status: input.status,
      output: input.output,
      risk: input.risk,
      maxChars: input.maxChars,
    });
    return { content: summary.content, redactionCount: summary.redactionCount };
  }
  return { content: `**Cron Job: ${input.jobName}**\n\n${input.output}`, redactionCount: 0 };
}

function splitFirst(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  if (index < 0) return [value, ''];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function normalizeMaxChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SUMMARY_MAX_CHARS;
  }
  return Math.min(8000, Math.max(80, Math.trunc(value)));
}
