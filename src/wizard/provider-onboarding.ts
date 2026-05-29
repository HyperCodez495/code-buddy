/**
 * Provider Onboarding
 *
 * Guided setup for AI providers with API key validation.
 * Each provider config defines the env key, base URL, and a validation
 * endpoint that is probed with a GET request to confirm the key works.
 */

import * as readline from 'readline';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProviderOnboardingConfig {
  /** Unique provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Environment variable for the API key */
  envKey: string;
  /** Base URL for the provider API */
  baseUrl: string;
  /** GET endpoint to validate the key (relative to baseUrl) */
  validateEndpoint: string;
  /** User-facing instructions for obtaining an API key */
  instructions: string;
  /** Optional OAuth flow parameters */
  oauthFlow?: {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
  };
}

export interface ProviderValidationResult {
  valid: boolean;
  models?: string[];
  error?: string;
}

// ============================================================================
// Provider Configs
// ============================================================================

export const PROVIDER_CONFIGS: ProviderOnboardingConfig[] = [
  {
    id: 'grok',
    name: 'Grok (xAI)',
    envKey: 'GROK_API_KEY',
    baseUrl: 'https://api.x.ai',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://console.x.ai',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://console.anthropic.com',
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    envKey: 'GOOGLE_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com',
    validateEndpoint: '/v1beta/models',
    instructions: 'Get your API key from https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    envKey: 'OLLAMA_HOST',
    baseUrl: 'http://localhost:11434',
    validateEndpoint: '/api/tags',
    instructions: 'Install Ollama from https://ollama.ai and run `ollama serve`',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://openrouter.ai/keys',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    envKey: 'LMSTUDIO_HOST',
    baseUrl: 'http://localhost:1234',
    validateEndpoint: '/v1/models',
    instructions: 'Install LM Studio from https://lmstudio.ai and start the server',
  },
];

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a provider API key by making a test request to the validation endpoint.
 * Returns the validation result including available models on success.
 */
export async function validateProviderKey(
  config: ProviderOnboardingConfig,
  apiKey: string
): Promise<ProviderValidationResult> {
  const url = `${config.baseUrl}${config.validateEndpoint}`;

  // Build headers — some providers use different auth schemes
  const headers: Record<string, string> = {};

  if (config.id === 'google') {
    // Gemini uses query param auth, not header
  } else if (config.id === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (config.id === 'ollama' || config.id === 'lmstudio') {
    // Local providers typically don't need auth
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Gemini uses query parameter for the API key
  const finalUrl =
    config.id === 'google' ? `${url}?key=${apiKey}` : url;

  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout') || message.includes('aborted')) {
      return { valid: false, error: `Connection timed out: ${config.baseUrl}` };
    }
    return {
      valid: false,
      error: `Failed to connect to ${config.name}: ${message}`,
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key (authentication failed)' };
    }
    return {
      valid: false,
      error: `API error (${response.status}): ${errorText.slice(0, 200)}`,
    };
  }

  // Extract model list from response
  const models = await extractModels(config, response);

  return { valid: true, models };
}

/**
 * Parse the model list from a provider's validation response.
 */
async function extractModels(
  config: ProviderOnboardingConfig,
  response: Response
): Promise<string[]> {
  try {
    const data = await response.json();
    const body = data as Record<string, unknown>;

    if (config.id === 'ollama') {
      // Ollama: { models: [{ name: "llama3" }] }
      const models = body.models as { name: string }[] | undefined;
      return models?.map((m) => m.name) ?? [];
    }

    if (config.id === 'google') {
      // Gemini: { models: [{ name: "models/gemini-pro" }] }
      const models = body.models as { name: string }[] | undefined;
      return models?.map((m) => m.name.replace('models/', '')) ?? [];
    }

    // OpenAI-compatible: { data: [{ id: "gpt-4o" }] }
    const modelData = body.data as { id: string }[] | undefined;
    return modelData?.map((m) => m.id) ?? [];
  } catch {
    return [];
  }
}

// ============================================================================
// Interactive Onboarding
// ============================================================================

/**
 * Run interactive onboarding for a specific provider.
 * Prompts for API key, validates it, and saves to the environment.
 */
export async function runProviderOnboarding(
  providerId: string
): Promise<boolean> {
  const config = PROVIDER_CONFIGS.find((c) => c.id === providerId);
  if (!config) {
    logger.error(`Unknown provider: ${providerId}`);
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(`  ${question}`, (answer) => resolve(answer.trim()));
    });

  try {
    console.log('');
    console.log(`  === ${config.name} Setup ===`);
    console.log('');
    console.log(`  ${config.instructions}`);
    console.log('');

    // Check if already configured
    const existingKey = process.env[config.envKey];
    if (existingKey) {
      console.log(`  ${config.envKey} is already set in your environment.`);
      const revalidate = await ask('  Validate existing key? (y/n) [y]: ');
      if (revalidate.toLowerCase() !== 'n') {
        console.log('  Validating...');
        const result = await validateProviderKey(config, existingKey);
        if (result.valid) {
          console.log('  Key is valid!');
          if (result.models && result.models.length > 0) {
            console.log(`  Available models: ${result.models.slice(0, 5).join(', ')}${result.models.length > 5 ? '...' : ''}`);
          }
          rl.close();
          return true;
        }
        console.log(`  Validation failed: ${result.error}`);
      }
    }

    // Local providers (Ollama, LM Studio) check connectivity only
    if (config.id === 'ollama' || config.id === 'lmstudio') {
      console.log(`  Checking ${config.name} connectivity...`);
      const host =
        config.id === 'ollama'
          ? process.env.OLLAMA_HOST || config.baseUrl
          : process.env.LMSTUDIO_HOST || config.baseUrl;

      const result = await validateProviderKey(
        { ...config, baseUrl: host },
        ''
      );
      if (result.valid) {
        console.log(`  ${config.name} is running and accessible!`);
        if (result.models && result.models.length > 0) {
          console.log(`  Available models: ${result.models.join(', ')}`);
        }
        rl.close();
        return true;
      }
      console.log(`  Could not connect: ${result.error}`);
      console.log(`  Make sure ${config.name} is running.`);
      rl.close();
      return false;
    }

    // Prompt for API key
    const apiKey = await ask(`  Enter your ${config.name} API key: `);
    if (!apiKey) {
      console.log('  No API key provided. Skipping validation.');
      rl.close();
      return false;
    }

    // Validate
    console.log('  Validating...');
    const result = await validateProviderKey(config, apiKey);

    if (!result.valid) {
      console.log(`  Validation failed: ${result.error}`);
      console.log('');
      console.log('  The key was not saved. Please check your API key and try again.');
      rl.close();
      return false;
    }

    console.log('  Key is valid!');
    if (result.models && result.models.length > 0) {
      console.log(
        `  Available models: ${result.models.slice(0, 5).join(', ')}${result.models.length > 5 ? ` (+${result.models.length - 5} more)` : ''}`
      );
    }

    // Set in process environment (for current session)
    process.env[config.envKey] = apiKey;
    console.log('');
    console.log(`  ${config.envKey} set for this session.`);
    console.log(
      `  To persist, add to your shell profile: export ${config.envKey}="${apiKey}"`
    );
    console.log('');

    rl.close();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Provider onboarding failed', { provider: providerId, error: msg });
    rl.close();
    return false;
  }
}

/**
 * Run interactive onboarding that lets the user choose a provider.
 */
export async function runFullProviderOnboarding(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askChoice = (question: string, choices: string[]): Promise<number> =>
    new Promise((resolve) => {
      console.log(`\n  ${question}`);
      choices.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
      rl.question(`  Choice [1]: `, (answer) => {
        const idx = parseInt(answer) - 1;
        resolve(idx >= 0 && idx < choices.length ? idx : 0);
      });
    });

  try {
    console.log('');
    console.log('  === Provider Onboarding ===');
    console.log('');

    const choiceIdx = await askChoice(
      'Which AI provider would you like to set up?',
      PROVIDER_CONFIGS.map((c) => `${c.name} (${c.envKey})`)
    );

    rl.close();

    const config = PROVIDER_CONFIGS[choiceIdx];
    if (!config) {
      logger.error('No provider configuration available to onboard');
      return false;
    }
    return await runProviderOnboarding(config.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Full provider onboarding failed', { error: msg });
    rl.close();
    return false;
  }
}

/**
 * Get a provider config by ID.
 */
export function getProviderConfig(
  providerId: string
): ProviderOnboardingConfig | undefined {
  return PROVIDER_CONFIGS.find((c) => c.id === providerId);
}

/**
 * List all configured providers (those with env keys set).
 */
export function listConfiguredProviders(): ProviderOnboardingConfig[] {
  return PROVIDER_CONFIGS.filter((c) => {
    if (c.id === 'ollama' || c.id === 'lmstudio') {
      // Local providers are always "available" (may not be running)
      return true;
    }
    return !!process.env[c.envKey];
  });
}
