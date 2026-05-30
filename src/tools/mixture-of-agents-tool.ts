import type { ToolResult } from '../types/index.js';

export interface MixtureOfAgentsOptions {
  apiKey?: string;
  baseUrl?: string;
  referenceModels?: string[];
  aggregatorModel?: string;
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
  minSuccessfulReferences?: number;
}

export interface MixtureOfAgentsResult {
  success: boolean;
  response: string;
  models_used: {
    reference_models: string[];
    aggregator_model: string;
  };
  processing_time: number;
  reference_results: Array<{
    model: string;
    success: boolean;
    chars?: number;
    error?: string;
  }>;
  error?: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ReferenceResult {
  model: string;
  content: string;
  success: boolean;
  error?: string;
}

interface RuntimeConfig {
  apiKey: string;
  baseUrl: string;
  referenceModels: string[];
  aggregatorModel: string;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  minSuccessfulReferences: number;
}

const DEFAULT_REFERENCE_MODELS = [
  'anthropic/claude-opus-4.6',
  'google/gemini-2.5-pro',
  'openai/gpt-5.4-pro',
  'deepseek/deepseek-v3.2',
];

const DEFAULT_AGGREGATOR_MODEL = 'anthropic/claude-opus-4.6';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MIN_SUCCESSFUL_REFERENCES = 1;
const REFERENCE_TEMPERATURE = 0.6;
const AGGREGATOR_TEMPERATURE = 0.4;

const AGGREGATOR_SYSTEM_PROMPT =
  'You have been provided with a set of responses from various open-source models to the latest user query. ' +
  'Your task is to synthesize these responses into a single, high-quality response. It is crucial to critically ' +
  'evaluate the information provided in these responses, recognizing that some of it may be biased or incorrect. ' +
  'Your response should not simply replicate the given answers but should offer a refined, accurate, and ' +
  'comprehensive reply to the instruction. Ensure your response is well-structured, coherent, and adheres to ' +
  'the highest standards of accuracy and reliability.\n\nResponses from models:';

export async function executeMixtureOfAgents(
  input: Record<string, unknown>,
  options: MixtureOfAgentsOptions = {},
): Promise<ToolResult> {
  const userPrompt = readNonEmptyString(input.user_prompt);
  if (!userPrompt) {
    return { success: false, error: 'mixture_of_agents: user_prompt is required.' };
  }

  let config: RuntimeConfig;
  try {
    config = resolveRuntimeConfig(options);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const started = Date.now();
  const referenceResults = await Promise.all(
    config.referenceModels.map((model) => runReferenceModel(model, userPrompt, config)),
  );
  const successfulResponses = referenceResults
    .filter((result) => result.success && result.content.trim())
    .map((result) => result.content);

  if (successfulResponses.length < config.minSuccessfulReferences) {
    const result = buildResult({
      config,
      error:
        `Insufficient successful reference models (${successfulResponses.length}/` +
        `${config.referenceModels.length}). Need at least ${config.minSuccessfulReferences}.`,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response: 'MoA processing failed. Please try again or use a single model for this query.',
      success: false,
    });
    return {
      success: false,
      error: result.error,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }

  try {
    const systemPrompt = constructAggregatorPrompt(successfulResponses);
    const response = await runAggregatorModel(systemPrompt, userPrompt, config);
    const result = buildResult({
      config,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response,
      success: true,
    });
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = buildResult({
      config,
      error: `Error in MoA processing: ${message}`,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response: 'MoA processing failed. Please try again or use a single model for this query.',
      success: false,
    });
    return {
      success: false,
      error: result.error,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }
}

function resolveRuntimeConfig(options: MixtureOfAgentsOptions): RuntimeConfig {
  const apiKey =
    options.apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.CODEBUDDY_MOA_API_KEY;
  if (!apiKey) {
    throw new Error('mixture_of_agents requires OPENROUTER_API_KEY or CODEBUDDY_MOA_API_KEY.');
  }

  const referenceModels = nonEmptyList(options.referenceModels)
    ?? parseEnvList(process.env.CODEBUDDY_MOA_REFERENCE_MODELS)
    ?? DEFAULT_REFERENCE_MODELS;
  const aggregatorModel =
    options.aggregatorModel
    ?? readNonEmptyString(process.env.CODEBUDDY_MOA_AGGREGATOR_MODEL)
    ?? DEFAULT_AGGREGATOR_MODEL;

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      options.baseUrl
      ?? process.env.CODEBUDDY_MOA_BASE_URL
      ?? process.env.OPENROUTER_BASE_URL
      ?? DEFAULT_BASE_URL,
    ),
    referenceModels,
    aggregatorModel,
    timeoutMs: positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxTokens: positiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS),
    maxRetries: positiveNumber(options.maxRetries, DEFAULT_MAX_RETRIES),
    minSuccessfulReferences: positiveNumber(
      options.minSuccessfulReferences,
      DEFAULT_MIN_SUCCESSFUL_REFERENCES,
    ),
  };
}

async function runReferenceModel(
  model: string,
  userPrompt: string,
  config: RuntimeConfig,
): Promise<ReferenceResult> {
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const content = await postChatCompletion({
        config,
        messages: [{ role: 'user', content: userPrompt }],
        model,
        temperature: REFERENCE_TEMPERATURE,
      });
      if (content.trim()) {
        return { model, content, success: true };
      }
      if (attempt === config.maxRetries) {
        return { model, content: '', success: false, error: 'empty model response' };
      }
    } catch (error) {
      if (attempt === config.maxRetries) {
        return {
          model,
          content: '',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return { model, content: '', success: false, error: 'model did not return a response' };
}

async function runAggregatorModel(
  systemPrompt: string,
  userPrompt: string,
  config: RuntimeConfig,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const first = await postChatCompletion({
    config,
    messages,
    model: config.aggregatorModel,
    temperature: AGGREGATOR_TEMPERATURE,
  });
  if (first.trim()) return first;
  return postChatCompletion({
    config,
    messages,
    model: config.aggregatorModel,
    temperature: AGGREGATOR_TEMPERATURE,
  });
}

async function postChatCompletion(input: {
  config: RuntimeConfig;
  messages: ChatMessage[];
  model: string;
  temperature: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      max_tokens: input.config.maxTokens,
      reasoning: {
        enabled: true,
        effort: 'xhigh',
      },
    };
    if (!isOpenAiGptModel(input.model)) {
      body.temperature = input.temperature;
    }

    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`OpenRouter-compatible API error ${response.status}: ${extractError(payload)}`);
    }
    const content = extractContentOrReasoning(payload);
    if (!content) {
      throw new Error('OpenRouter-compatible API response did not include assistant content.');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function extractContentOrReasoning(payload: unknown): string {
  const root = asRecord(payload);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message ? contentToString(message.content) : '';
  if (content) return content;
  return readNonEmptyString(message?.reasoning) ?? readNonEmptyString(firstChoice?.reasoning) ?? '';
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const item = asRecord(part);
      return readNonEmptyString(item?.text) ?? readNonEmptyString(item?.content) ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractError(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  return readNonEmptyString(error?.message)
    ?? readNonEmptyString(root?.message)
    ?? readNonEmptyString(root?.raw)
    ?? 'unknown error';
}

function constructAggregatorPrompt(responses: string[]): string {
  const responseText = responses.map((response, index) => `${index + 1}. ${response}`).join('\n');
  return `${AGGREGATOR_SYSTEM_PROMPT}\n\n${responseText}`;
}

function buildResult(input: {
  config: RuntimeConfig;
  error?: string;
  processingTime: number;
  referenceResults: ReferenceResult[];
  response: string;
  success: boolean;
}): MixtureOfAgentsResult {
  return {
    success: input.success,
    response: input.response,
    models_used: {
      reference_models: input.config.referenceModels,
      aggregator_model: input.config.aggregatorModel,
    },
    processing_time: input.processingTime,
    reference_results: input.referenceResults.map((result) => ({
      model: result.model,
      success: result.success,
      ...(result.success ? { chars: result.content.length } : {}),
      ...(result.error ? { error: result.error } : {}),
    })),
    ...(input.error ? { error: input.error } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonEmptyList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return normalized.length > 0 ? normalized.map((item) => item.trim()) : undefined;
}

function parseEnvList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isOpenAiGptModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('gpt-') || normalized.startsWith('openai/gpt-');
}

function elapsedSeconds(started: number): number {
  return (Date.now() - started) / 1000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
