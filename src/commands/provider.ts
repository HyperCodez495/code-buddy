/**
 * Provider Command
 *
 * CLI commands for managing AI providers (Claude, ChatGPT, Grok, Gemini)
 */

import { Command } from 'commander';
import { logger } from "../utils/logger.js";
import { getSettingsManager } from '../utils/settings-manager.js';
import { hasCodexCredentials } from '../providers/codex-oauth.js';
import {
  findRuntimeProvider,
  getPluginNativeRuntimeProviderCatalog,
  getProviderEnvSummary,
  getRuntimeProviderCatalog,
  isProviderConfigured,
  resolvePluginRuntimeProvider,
  type RuntimeProviderCatalogEntry,
  type RuntimeProviderId,
} from '../providers/provider-catalog.js';

interface ProviderInfo {
  name: string;
  envVar: string;
  envVars: string[];
  models: string[];
  defaultModel: string;
  baseURL?: string;
  providerId: RuntimeProviderId;
  authMode: RuntimeProviderCatalogEntry['authMode'];
}

const PROVIDER_COMMAND_KEYS: Record<RuntimeProviderId, string> = {
  chatgpt: 'chatgpt',
  ollama: 'ollama',
  'ollama-cloud': 'ollama-cloud',
  lmstudio: 'lmstudio',
  grok: 'grok',
  gemini: 'gemini',
  openai: 'openai',
  anthropic: 'claude',
  mistral: 'mistral',
  groq: 'groq',
  together: 'together',
  fireworks: 'fireworks',
  openrouter: 'openrouter',
  novita: 'novita',
  zai: 'zai',
  'kimi-coding': 'kimi-coding',
  'kimi-coding-cn': 'kimi-coding-cn',
  arcee: 'arcee',
  gmi: 'gmi',
  minimax: 'minimax',
  'minimax-cn': 'minimax-cn',
  alibaba: 'alibaba',
  'alibaba-coding-plan': 'alibaba-coding-plan',
  kilocode: 'kilocode',
  xiaomi: 'xiaomi',
  'tencent-tokenhub': 'tencent-tokenhub',
  'opencode-zen': 'opencode-zen',
  'opencode-go': 'opencode-go',
  deepseek: 'deepseek',
  huggingface: 'huggingface',
  nvidia: 'nvidia',
  stepfun: 'stepfun',
  vllm: 'vllm',
  custom: 'custom',
  azure: 'azure',
  bedrock: 'bedrock',
  copilot: 'copilot',
};

export const PROVIDERS: Record<string, ProviderInfo> = Object.fromEntries(
  getRuntimeProviderCatalog()
    .filter((entry) => entry.runtimeSupport === 'direct')
    .map((entry) => {
      const key = PROVIDER_COMMAND_KEYS[entry.id];
      return [
        key,
        {
          name: entry.label,
          envVar: getProviderEnvSummary(entry),
          envVars: entry.id === 'chatgpt'
            ? ['CODEBUDDY_CHATGPT_OAUTH']
            : [...entry.apiKeyEnvKeys, ...entry.baseUrlEnvKeys],
          models: entry.models,
          defaultModel: entry.defaultModel,
          baseURL: entry.defaultBaseURL,
          providerId: entry.id,
          authMode: entry.authMode,
        } satisfies ProviderInfo,
      ];
    }),
);

function getConfiguredProviders(): string[] {
  const configured: string[] = [];

  for (const [key, info] of Object.entries(PROVIDERS)) {
    const entry = findRuntimeProvider(info.providerId);
    if (entry && isProviderConfigured(entry, process.env, hasCodexCredentials())) {
      configured.push(key);
    }
  }

  return configured;
}

function getConfiguredPluginNativeProviders(): string[] {
  const configured: string[] = [];
  for (const entry of getPluginNativeRuntimeProviderCatalog()) {
    if (isProviderConfigured(entry, process.env, hasCodexCredentials())) {
      configured.push(entry.id);
    }
  }
  return configured;
}

function getCurrentProvider(): string {
  const manager = getSettingsManager();
  const settings = manager.loadUserSettings();
  return settings.provider || 'grok';
}

function setCurrentProvider(provider: string): void {
  const manager = getSettingsManager();
  manager.updateUserSetting('provider', provider);

  const providerInfo = PROVIDERS[provider];
  if (providerInfo?.baseURL) {
    manager.updateUserSetting('baseURL', providerInfo.baseURL);
  }
}

function getCurrentModel(): string | undefined {
  const manager = getSettingsManager();
  return manager.getCurrentModel();
}

function setCurrentModel(model: string): void {
  const manager = getSettingsManager() as {
    setCurrentModel?: (m: string) => void;
    updateUserSetting: <K extends 'model' | 'defaultModel'>(key: K, value: string) => void;
  };

  // Keep project runtime model aligned with provider/model CLI commands.
  if (typeof manager.setCurrentModel === 'function') {
    manager.setCurrentModel(model);
  }

  // Keep user-level model fields in sync for commands that rely on user settings.
  manager.updateUserSetting('model', model);
}

export function createProviderCommand(): Command {
  const provider = new Command('provider')
    .description('Manage AI providers');

  // List providers
  provider
    .command('list')
    .alias('ls')
    .description('List available AI providers')
    .action(() => {
      const configured = getConfiguredProviders();
      const configuredPluginProviders = getConfiguredPluginNativeProviders();
      const current = resolveProviderCommandKey(getCurrentProvider()) || getCurrentProvider();

      console.log('\nAvailable AI Providers:\n');

      for (const [key, info] of Object.entries(PROVIDERS)) {
        const isConfigured = configured.includes(key);
        const isCurrent = key === current;
        const status = isConfigured ? '✅' : '❌';
        const marker = isCurrent ? ' (active)' : '';

        console.log(`  ${status} ${info.name}${marker}`);
        console.log(`     Key: ${key}`);
        console.log(`     Env: ${info.envVar}`);
        console.log(`     Models: ${info.models.slice(0, 3).join(', ')}${info.models.length > 3 ? '...' : ''}`);
        console.log('');
      }

      const pluginProviders = getPluginNativeRuntimeProviderCatalog();
      if (pluginProviders.length > 0) {
        console.log('Plugin-native providers (available through bundled transports):\n');
        for (const entry of pluginProviders) {
          const status = configuredPluginProviders.includes(entry.id) ? '✅' : '❌';
          const runtime = resolvePluginRuntimeProvider(entry.id);
          console.log(`  ${status} ${entry.label}`);
          console.log(`     Key: ${PROVIDER_COMMAND_KEYS[entry.id]}`);
          console.log(`     Env: ${getProviderEnvSummary(entry)}`);
          console.log(`     Transport: ${runtime?.pluginId ?? 'bundled plugin'}`);
          console.log(`     Models: ${entry.models.slice(0, 3).join(', ')}${entry.models.length > 3 ? '...' : ''}`);
          console.log('');
        }
      }

      if (configured.length === 0 && configuredPluginProviders.length === 0) {
        console.log('⚠️  No providers configured. Set an API key environment variable.');
        console.log('   Example: export ANTHROPIC_API_KEY="your-key"');
      }
    });

  // Show current provider
  provider
    .command('current')
    .alias('show')
    .description('Show current active provider')
    .action(() => {
      const current = getCurrentProvider();
      const model = getCurrentModel();
      const key = resolveProviderCommandKey(current) || current;
      const info = PROVIDERS[key];

      console.log(`\nActive Provider: ${info?.name || current}`);
      console.log(`Model: ${model || info?.defaultModel || 'default'}`);

      const configured = getConfiguredProviders();
      if (!configured.includes(key)) {
        console.log(`\n⚠️  Warning: ${info?.envVar || 'API key'} not set`);
      }
    });

  // Set provider
  provider
    .command('set <provider>')
    .alias('use')
    .description('Set the active AI provider')
    .option('-m, --model <model>', 'Also set the model')
    .action((providerKey: string, options: { model?: string }) => {
      const key = resolveProviderCommandKey(providerKey);

      if (!key || !PROVIDERS[key]) {
        logger.error(`❌ Unknown provider: ${providerKey}`);
        logger.error(`   Available: ${Object.keys(PROVIDERS).join(', ')}`);
        process.exit(1);
      }

      const configured = getConfiguredProviders();
      if (!configured.includes(key)) {
        console.warn(`⚠️  Warning: ${PROVIDERS[key].envVar} not set`);
        console.warn(`   Provider will fail without API key`);
      }

      setCurrentProvider(key);
      console.log(`✅ Active provider set to: ${PROVIDERS[key].name}`);

      if (options.model) {
        setCurrentModel(options.model);
        console.log(`✅ Model set to: ${options.model}`);
      } else {
        // Set default model for provider
        setCurrentModel(PROVIDERS[key].defaultModel);
        console.log(`   Using default model: ${PROVIDERS[key].defaultModel}`);
      }
    });

  // List models for a provider
  provider
    .command('models [provider]')
    .description('List available models for a provider')
    .action((providerKey?: string) => {
      const key = resolveProviderCommandKey(providerKey || getCurrentProvider());

      if (!key || !PROVIDERS[key]) {
        logger.error(`❌ Unknown provider: ${providerKey}`);
        process.exit(1);
      }

      const info = PROVIDERS[key];
      const currentModel = getCurrentModel();

      console.log(`\nModels for ${info.name}:\n`);

      for (const model of info.models) {
        const isDefault = model === info.defaultModel;
        const isCurrent = model === currentModel;
        const markers: string[] = [];
        if (isDefault) markers.push('default');
        if (isCurrent) markers.push('active');

        const suffix = markers.length > 0 ? ` (${markers.join(', ')})` : '';
        console.log(`  • ${model}${suffix}`);
      }
    });

  // Set model
  provider
    .command('model <model>')
    .description('Set the AI model to use')
    .action((model: string) => {
      setCurrentModel(model);
      console.log(`✅ Model set to: ${model}`);
    });

  return provider;
}

export function resolveProviderCommandKey(provider: string): string | null {
  const normalized = provider.toLowerCase();
  if (PROVIDERS[normalized]) return normalized;
  const entry = findRuntimeProvider(normalized);
  if (!entry) return null;
  if (entry.runtimeSupport !== 'direct') return null;
  return PROVIDER_COMMAND_KEYS[entry.id] ?? null;
}

export default createProviderCommand;
