/**
 * Shared provider resolution for one-shot LLM CLI commands
 * (`buddy research`, `buddy flow`).
 *
 * Historically these commands resolved ONLY through the settings
 * provider + the `PROVIDERS` map (paid keys), so a machine running on
 * local Ollama (`CODEBUDDY_PROVIDER=ollama`, $0) hit the "no API key"
 * exit even though the rest of Code Buddy — including the autonomous
 * daemon — runs fine there. This resolver keeps the legacy path first
 * (backward compatible) and falls back to {@link detectProviderFromEnv}
 * (ollama / chatgpt-oauth / env-detected providers) when either:
 *   - `CODEBUDDY_PROVIDER` is explicitly set (operator intent wins), or
 *   - the legacy path found no key.
 */

import { getSettingsManager } from '../utils/settings-manager.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import { PROVIDERS } from './provider.js';

export interface ResolvedCommandProvider {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** Human-readable provider name for progress output. */
  providerLabel: string;
}

export function resolveCommandProvider(
  options: { explicitModel?: string } = {},
): ResolvedCommandProvider | null {
  const detectFirst = Boolean(process.env.CODEBUDDY_PROVIDER);
  if (detectFirst) {
    const detected = fromEnvDetection(options.explicitModel);
    if (detected) return detected;
  }

  const settingsManager = getSettingsManager();
  const settings = settingsManager.loadUserSettings();
  const currentProviderKey = settings.provider || 'grok';
  const providerInfo = PROVIDERS[currentProviderKey];

  let apiKey = process.env[providerInfo?.envVar || ''] || '';
  if (!apiKey && currentProviderKey === 'grok') apiKey = process.env.XAI_API_KEY || '';
  if (!apiKey && currentProviderKey === 'gemini') apiKey = process.env.GOOGLE_API_KEY || '';
  if (!apiKey) {
    apiKey =
      process.env.GROK_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      '';
  }

  if (apiKey) {
    const providerEnvBaseURL: Record<string, string | undefined> = {
      grok: process.env.GROK_BASE_URL,
      claude: process.env.ANTHROPIC_BASE_URL,
      openai: process.env.OPENAI_BASE_URL,
      gemini: process.env.GEMINI_BASE_URL,
    };
    return {
      apiKey,
      baseURL: providerEnvBaseURL[currentProviderKey] || providerInfo?.baseURL,
      model:
        options.explicitModel ||
        settingsManager.getCurrentModel() ||
        providerInfo?.defaultModel,
      providerLabel: providerInfo?.name || currentProviderKey,
    };
  }

  // Legacy path found nothing — fall back to env detection (local
  // Ollama, ChatGPT OAuth, …) so a $0 local machine can still run.
  return fromEnvDetection(options.explicitModel);
}

function fromEnvDetection(explicitModel?: string): ResolvedCommandProvider | null {
  const detected = detectProviderFromEnv();
  if (!detected) return null;
  return {
    apiKey: detected.apiKey,
    baseURL: detected.baseURL,
    model: explicitModel || detected.defaultModel,
    providerLabel: detected.provider,
  };
}
