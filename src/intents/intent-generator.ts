/** LLM-backed conversion of a natural-language task into a falsifiable intent. */

import { generateJsonWithRetry } from '../utils/llm-retry.js';
import { logger } from '../utils/logger.js';
import type { CreateIntentInput, IntentCriterion } from './intent-store.js';

export interface GenerateIntentOptions {
  model?: string;
}

export interface IntentGeneratorDeps {
  /** Injectable one-shot LLM seam for unit tests. */
  chat?: (system: string, user: string) => Promise<string>;
}

export type GeneratedIntent = Pick<CreateIntentInput, 'title' | 'files' | 'criteria' | 'body'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildIntentGeneratorSystemPrompt(): string {
  return (
    'You turn software tasks into durable, falsifiable intent specifications. ' +
    'Return only one JSON object with this exact shape:\n' +
    '{"title":"short title","files":["repo/relative/path"],"criteria":' +
    '[{"desc":"verifiable outcome","cmd":"non-interactive shell command","expectExit":0}]}\n' +
    'Every criterion must be objectively verifiable solely by its command exit code. ' +
    'Prefer focused commands such as `npm test -- tests/path.test.ts`, `npm run typecheck`, or `grep -q ...`. ' +
    'Commands must be non-interactive, bounded in scope, require no sudo, and avoid destructive actions. ' +
    'File paths must be relative to the repository root. Include at least one criterion.'
  );
}

function normalizeGeneratedIntent(raw: unknown, description: string): GeneratedIntent {
  const candidate = isRecord(raw) && isRecord(raw.intent) ? raw.intent : raw;
  if (!isRecord(candidate)) {
    throw new Error('the model response is not an intent object');
  }
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!title) throw new Error('the generated intent has no title');

  if (!Array.isArray(candidate.files)) throw new Error('the generated intent has no files array');
  const files = candidate.files
    .filter((file): file is string => typeof file === 'string' && file.trim() !== '')
    .map((file) => file.trim());
  if (files.length !== candidate.files.length) {
    throw new Error('the generated intent contains an invalid file path');
  }

  if (!Array.isArray(candidate.criteria) || candidate.criteria.length === 0) {
    throw new Error('the generated intent has no verifiable criteria');
  }
  const criteria: IntentCriterion[] = candidate.criteria.map((value, index) => {
    if (!isRecord(value)) throw new Error(`criterion ${index + 1} is not an object`);
    const desc = typeof value.desc === 'string' ? value.desc.trim() : '';
    const cmd = typeof value.cmd === 'string' ? value.cmd.trim() : '';
    if (!desc || !cmd || typeof value.expectExit !== 'number' || !Number.isSafeInteger(value.expectExit)) {
      throw new Error(`criterion ${index + 1} is incomplete or invalid`);
    }
    return { desc, cmd, expectExit: value.expectExit };
  });

  return {
    title,
    files,
    criteria,
    body: `## Context\n\n${description.trim()}\n`,
  };
}

async function defaultChat(system: string, user: string, model?: string): Promise<string> {
  const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
  const resolved = resolveCommandProvider(model ? { explicitModel: model } : {});
  if (!resolved) {
    throw new Error(
      'No LLM provider is configured. Run `buddy login` or configure a provider API key.',
    );
  }
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
  const response = await client.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    undefined,
    { responseFormat: 'json' },
  );
  return response.choices?.[0]?.message?.content ?? '';
}

export async function generateIntent(
  description: string,
  options: GenerateIntentOptions = {},
  deps: IntentGeneratorDeps = {},
): Promise<GeneratedIntent> {
  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    throw new Error('Cannot generate an intent from an empty description.');
  }
  const system = buildIntentGeneratorSystemPrompt();
  const chat = deps.chat ?? ((systemPrompt: string, userPrompt: string) =>
    defaultChat(systemPrompt, userPrompt, options.model));
  try {
    const raw = await generateJsonWithRetry<unknown>(
      (prompt) => chat(system, prompt),
      `Task description:\n${normalizedDescription}`,
      1,
    );
    const intent = normalizeGeneratedIntent(raw, normalizedDescription);
    logger.info(`[intents] Generated intent "${intent.title}" with ${intent.criteria.length} criterion/criteria.`);
    return intent;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('[intents] Intent generation failed.', { error: detail });
    throw new Error(`Unable to generate a valid intent: ${detail}`);
  }
}
