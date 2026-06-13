import {
  CodeBuddyClient,
  type ChatOptions,
} from '../codebuddy/client.js';
import { hasCodexCredentials } from './codex-oauth.js';
import {
  findRuntimeProvider,
  resolveProviderFromCatalog,
  type ResolvedRuntimeProvider,
} from './provider-catalog.js';

type EnvLike = Record<string, string | undefined>;

export type RuntimeAuxiliaryTask =
  | 'vision'
  | 'browser_vision'
  | 'web_extract'
  | 'approval'
  | 'compression'
  | 'skills_hub'
  | 'mcp'
  | 'triage_specifier'
  | 'session_title';

export interface RuntimeAuxiliaryMainProvider extends ResolvedRuntimeProvider {
  model?: string;
}

export interface RuntimeAuxiliaryResolveOptions {
  task: RuntimeAuxiliaryTask;
  env?: EnvLike;
  hasChatGptOAuth?: boolean;
  mainProvider?: RuntimeAuxiliaryMainProvider | null;
  defaultTimeoutMs?: number;
}

export interface ResolvedRuntimeAuxiliaryProvider extends ResolvedRuntimeProvider {
  task: RuntimeAuxiliaryTask;
  model: string;
  timeoutMs: number;
  providerSetting: string;
  extraBody?: Record<string, unknown>;
}

interface AuxiliaryEnvConfig {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
}

const DEFAULT_AUXILIARY_TIMEOUT_MS: Record<RuntimeAuxiliaryTask, number> = {
  vision: 120_000,
  browser_vision: 120_000,
  web_extract: 360_000,
  approval: 30_000,
  compression: 120_000,
  skills_hub: 30_000,
  mcp: 30_000,
  triage_specifier: 120_000,
  session_title: 30_000,
};

const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-flash';

export function resolveRuntimeAuxiliaryProvider(
  options: RuntimeAuxiliaryResolveOptions,
): ResolvedRuntimeAuxiliaryProvider | null {
  const env = options.env ?? process.env;
  const config = readAuxiliaryEnvConfig(options.task, env);
  const providerSetting = (config.provider || 'auto').trim().toLowerCase();
  const timeoutMs = config.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_AUXILIARY_TIMEOUT_MS[options.task];
  const hasOAuth = options.hasChatGptOAuth ?? hasCodexCredentials();

  if (providerSetting === 'main') {
    return resolveFromMainProvider(options, config, timeoutMs, providerSetting);
  }

  if (providerSetting === 'auto') {
    const autoResolved = resolveAutoAuxiliaryProvider(options, config, timeoutMs, hasOAuth);
    if (autoResolved) return autoResolved;
    return resolveFromMainProvider(options, config, timeoutMs, providerSetting);
  }

  return resolveSpecificAuxiliaryProvider(
    options.task,
    providerSetting,
    env,
    config,
    timeoutMs,
    hasOAuth,
  );
}

export function createAuxiliaryCodeBuddyClient(
  provider: ResolvedRuntimeAuxiliaryProvider,
): CodeBuddyClient {
  return new CodeBuddyClient(provider.apiKey, provider.model, provider.baseURL, {
    enableFallbacks: false,
  });
}

export function createAuxiliaryChatOptions(
  provider: ResolvedRuntimeAuxiliaryProvider,
  overrides: ChatOptions = {},
): ChatOptions {
  return {
    ...overrides,
    model: overrides.model ?? provider.model,
    timeoutMs: overrides.timeoutMs ?? provider.timeoutMs,
  };
}

function resolveAutoAuxiliaryProvider(
  options: RuntimeAuxiliaryResolveOptions,
  config: AuxiliaryEnvConfig,
  timeoutMs: number,
  hasOAuth: boolean,
): ResolvedRuntimeAuxiliaryProvider | null {
  if ((options.task === 'vision' || options.task === 'browser_vision') && hasEnvValue(options.env ?? process.env, 'OPENROUTER_API_KEY')) {
    return resolveSpecificAuxiliaryProvider(
      options.task,
      'openrouter',
      options.env ?? process.env,
      {
        ...config,
        model: config.model || OPENROUTER_VISION_MODEL,
      },
      timeoutMs,
      hasOAuth,
    );
  }

  if (options.mainProvider) {
    return resolveFromMainProvider(options, config, timeoutMs, 'auto');
  }

  const resolved = resolveProviderFromCatalog({
    env: options.env,
    hasChatGptOAuth: hasOAuth,
    requireConfigured: true,
  });
  if (!resolved) return null;
  return finalizeAuxiliaryProvider(options.task, resolved, config, timeoutMs, 'auto');
}

function resolveFromMainProvider(
  options: RuntimeAuxiliaryResolveOptions,
  config: AuxiliaryEnvConfig,
  timeoutMs: number,
  providerSetting: string,
): ResolvedRuntimeAuxiliaryProvider | null {
  const mainProvider = options.mainProvider;
  if (!mainProvider) return null;
  return finalizeAuxiliaryProvider(options.task, mainProvider, config, timeoutMs, providerSetting);
}

function resolveSpecificAuxiliaryProvider(
  task: RuntimeAuxiliaryTask,
  providerSetting: string,
  env: EnvLike,
  config: AuxiliaryEnvConfig,
  timeoutMs: number,
  hasOAuth: boolean,
): ResolvedRuntimeAuxiliaryProvider | null {
  const entry = findRuntimeProvider(providerSetting);
  if (!entry || entry.runtimeSupport !== 'direct') return null;

  const envOverlay = { ...env };
  if (config.apiKey && entry.apiKeyEnvKeys[0]) {
    envOverlay[entry.apiKeyEnvKeys[0]] = config.apiKey;
  }
  if (config.baseURL && entry.baseUrlEnvKeys[0]) {
    envOverlay[entry.baseUrlEnvKeys[0]] = config.baseURL;
  }
  if (config.model && entry.modelEnvKeys[0]) {
    envOverlay[entry.modelEnvKeys[0]] = config.model;
  }

  const resolved = resolveProviderFromCatalog({
    providerOverride: providerSetting,
    env: envOverlay,
    hasChatGptOAuth: hasOAuth,
    requireConfigured: true,
  });
  if (!resolved) return null;
  return finalizeAuxiliaryProvider(task, resolved, config, timeoutMs, providerSetting);
}

function finalizeAuxiliaryProvider(
  task: RuntimeAuxiliaryTask,
  provider: RuntimeAuxiliaryMainProvider,
  config: AuxiliaryEnvConfig,
  timeoutMs: number,
  providerSetting: string,
): ResolvedRuntimeAuxiliaryProvider {
  return {
    ...provider,
    apiKey: config.apiKey || provider.apiKey,
    baseURL: (config.baseURL || provider.baseURL).replace(/\/+$/, ''),
    defaultModel: config.model || provider.model || provider.defaultModel,
    task,
    model: config.model || provider.model || provider.defaultModel,
    timeoutMs,
    providerSetting,
    ...(config.extraBody ? { extraBody: config.extraBody } : {}),
  };
}

function readAuxiliaryEnvConfig(task: RuntimeAuxiliaryTask, env: EnvLike): AuxiliaryEnvConfig {
  const taskKey = task.toUpperCase();
  const provider = readFirstEnv(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_PROVIDER`,
    `AUXILIARY_${taskKey}_PROVIDER`,
    'CODEBUDDY_AUXILIARY_PROVIDER',
    'AUXILIARY_PROVIDER',
  ]);
  const model = readFirstEnv(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_MODEL`,
    `AUXILIARY_${taskKey}_MODEL`,
    'CODEBUDDY_AUXILIARY_MODEL',
    'AUXILIARY_MODEL',
  ]);
  const baseURL = readFirstEnv(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_BASE_URL`,
    `AUXILIARY_${taskKey}_BASE_URL`,
    'CODEBUDDY_AUXILIARY_BASE_URL',
    'AUXILIARY_BASE_URL',
  ]);
  const apiKey = readFirstEnv(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_API_KEY`,
    `AUXILIARY_${taskKey}_API_KEY`,
    'CODEBUDDY_AUXILIARY_API_KEY',
    'AUXILIARY_API_KEY',
  ]);
  const timeoutEntry = readFirstEnvEntry(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_TIMEOUT_MS`,
    `AUXILIARY_${taskKey}_TIMEOUT_MS`,
    `AUXILIARY_${taskKey}_TIMEOUT`,
    'CODEBUDDY_AUXILIARY_TIMEOUT_MS',
    'AUXILIARY_TIMEOUT_MS',
  ]);
  const extraBodyRaw = readFirstEnv(env, [
    `CODEBUDDY_AUXILIARY_${taskKey}_EXTRA_BODY`,
    `AUXILIARY_${taskKey}_EXTRA_BODY`,
    'CODEBUDDY_AUXILIARY_EXTRA_BODY',
    'AUXILIARY_EXTRA_BODY',
  ]);

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(timeoutEntry ? { timeoutMs: parseTimeoutMs(timeoutEntry.value, timeoutEntry.key.endsWith('_TIMEOUT')) } : {}),
    ...(extraBodyRaw ? { extraBody: parseExtraBody(extraBodyRaw) } : {}),
  };
}

function readFirstEnv(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readFirstEnvEntry(env: EnvLike, keys: string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

function hasEnvValue(env: EnvLike, key: string): boolean {
  return readFirstEnv(env, [key]) !== undefined;
}

function parseTimeoutMs(value: string, seconds: boolean): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(seconds ? numeric * 1000 : numeric);
}

function parseExtraBody(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
