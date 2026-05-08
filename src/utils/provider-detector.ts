/**
 * Provider auto-detection — extracted from src/index.ts (Phase d.25).
 *
 * Reads env vars + filesystem state to pick the active LLM provider for
 * a Code Buddy session. Pure function (no side effects beyond stat/read
 * on the OAuth file) so it's unit-testable.
 *
 * Priority order:
 *   0. CODEBUDDY_PROVIDER override (always wins when set + valid)
 *   1. ChatGPT OAuth credentials present (~/.codebuddy/codex-auth.json)
 *      → explicit "I logged in" act beats ambient env vars
 *   2. OLLAMA_HOST    → ollama (local, free, unlimited)
 *   3. GROK_API_KEY   → grok / OpenAI-compat (incl. xAI)
 *   4. GEMINI/GOOGLE  → gemini
 *   5. OPENAI         → openai
 *   6. ANTHROPIC      → anthropic
 *   else null (no provider available)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DetectedProvider {
  provider: 'gemini' | 'grok' | 'openai' | 'anthropic' | 'ollama' | 'chatgpt' | 'unknown';
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

export function detectProviderFromEnv(): DetectedProvider | null {
  const override = process.env.CODEBUDDY_PROVIDER?.toLowerCase();

  // ChatGPT subscription auth — explicit login wins over ambient
  // env-detected providers. User who ran `buddy login chatgpt` recently
  // expects subsequent calls to route through their ChatGPT plan, not
  // get hijacked by an OLLAMA_HOST set in their shell rc weeks ago.
  if (override === 'chatgpt' || !override) {
    try {
      const authPath = path.join(os.homedir(), '.codebuddy', 'codex-auth.json');
      if (fs.existsSync(authPath)) {
        const raw = fs.readFileSync(authPath, 'utf-8').trim();
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.tokens?.access_token) {
          return {
            provider: 'chatgpt',
            apiKey: 'oauth-chatgpt',
            baseURL: 'https://chatgpt.com/backend-api/codex',
            defaultModel: process.env.CHATGPT_MODEL || 'gpt-5.5',
          };
        }
      }
    } catch {
      // Malformed auth file or unexpected — fall through.
    }
  }

  if (override === 'ollama' || (!override && process.env.OLLAMA_HOST)) {
    let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
    if (!host.endsWith('/v1')) host = host.replace(/\/+$/, '') + '/v1';
    return {
      provider: 'ollama',
      apiKey: 'ollama',
      baseURL: host,
      defaultModel: process.env.GROK_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    };
  }

  if (
    (override === 'grok' || override === 'xai') ||
    (!override && (process.env.GROK_API_KEY || process.env.XAI_API_KEY))
  ) {
    return {
      provider: 'grok',
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
      baseURL: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      defaultModel: process.env.GROK_MODEL || 'grok-3-fast',
    };
  }

  if (
    (override === 'gemini' || override === 'google') ||
    (!override && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))
  ) {
    return {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  }

  if (override === 'openai' || (!override && process.env.OPENAI_API_KEY)) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (override === 'anthropic' || (!override && process.env.ANTHROPIC_API_KEY)) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseURL: 'https://api.anthropic.com/v1',
      defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    };
  }

  return null;
}
