/**
 * AI Completion Provider
 *
 * Provides AI-powered inline code completions via the LLM.
 * Supports Fill-in-the-Middle (FIM) format for compatible models
 * and falls back to a simple completion prompt otherwise.
 *
 * Features:
 * - Debounced requests (configurable, default 300ms)
 * - Cancellation support via CancellationToken-like interface
 * - LRU cache integration via CompletionCache
 * - Multi-line snippet completions (InsertTextFormat.Snippet)
 * - Max 3 suggestions, max 200 tokens each (configurable)
 */

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver/node';
import { CodeBuddyClient, CodeBuddyMessage } from '../codebuddy/client.js';
import { CompletionCache } from './completion-cache.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Cancellation token interface (compatible with LSP CancellationToken)
 */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?: (handler: () => void) => void;
}

/**
 * Context passed to the AI completion provider
 */
export interface AICompletionContext {
  /** Text before cursor (current line up to cursor) */
  prefix: string;
  /** Text after cursor (rest of current line) */
  suffix: string;
  /** Detected programming language */
  language: string;
  /** File path */
  filePath: string;
  /** Lines before the cursor line (up to 15) */
  linesBefore?: string[];
  /** Lines after the cursor line (up to 5) */
  linesAfter?: string[];
}

/**
 * Configuration for the AI completion provider
 */
export interface AICompletionConfig {
  /** Whether AI completions are enabled */
  enabled: boolean;
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Maximum number of suggestions to return */
  maxSuggestions: number;
  /** Maximum tokens per completion */
  maxTokens: number;
  /** Optional model override (uses client default if not set) */
  model?: string;
}

/** Default configuration */
export const DEFAULT_AI_COMPLETION_CONFIG: AICompletionConfig = {
  enabled: true,
  debounceMs: 300,
  maxSuggestions: 3,
  maxTokens: 200,
};

// ---------------------------------------------------------------------------
// FIM-capable model detection
// ---------------------------------------------------------------------------

/**
 * Models known to support Fill-in-the-Middle (FIM) natively.
 * These models understand <|fim_prefix|>/<|fim_suffix|>/<|fim_middle|> tokens.
 */
const FIM_CAPABLE_PATTERNS = [
  /^grok-code/i,
  /^codestral/i,
  /^deepseek-coder/i,
  /^starcoder/i,
  /^codellama/i,
  /^code-llama/i,
  /^qwen.*coder/i,
  /^yi-coder/i,
];

/**
 * Check if a model supports FIM format
 */
export function isFIMCapable(model: string): boolean {
  return FIM_CAPABLE_PATTERNS.some((pattern) => pattern.test(model));
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build a Fill-in-the-Middle prompt for FIM-capable models
 */
export function buildFIMPrompt(
  context: AICompletionContext,
  _position: { line: number; character: number },
): string {
  const beforeLines = context.linesBefore?.slice(-15) ?? [];
  const afterLines = context.linesAfter?.slice(0, 5) ?? [];

  const fullPrefix = [...beforeLines, context.prefix].join('\n');
  const fullSuffix = [context.suffix, ...afterLines].join('\n');

  return `<|fim_prefix|>${fullPrefix}<|fim_suffix|>${fullSuffix}<|fim_middle|>`;
}

/**
 * Build a standard completion prompt for models without FIM support
 */
export function buildStandardPrompt(
  context: AICompletionContext,
  position: { line: number; character: number },
): CodeBuddyMessage[] {
  const beforeLines = context.linesBefore?.slice(-10) ?? [];
  const afterLines = context.linesAfter?.slice(0, 3) ?? [];

  const codeContext = [
    ...beforeLines,
    context.prefix + '█' + context.suffix,
    ...afterLines,
  ].join('\n');

  return [
    {
      role: 'system' as const,
      content: `You are a ${context.language} code completion engine. Complete the code at the cursor position (marked with █). Return ONLY the completion text, no explanation, no markdown fences. If multiple completions are possible, return up to 3 separated by \\n---\\n`,
    },
    {
      role: 'user' as const,
      content: `Complete the following code. Return ONLY the completion, no explanation.\nFile: ${context.filePath} (line ${position.line + 1})\n\n${codeContext}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse AI response into completion strings.
 * Handles markdown fences, separator markers, and multi-line output.
 */
export function parseCompletionResponse(
  rawResponse: string,
  maxSuggestions: number,
): string[] {
  if (!rawResponse || rawResponse.trim().length === 0) {
    return [];
  }

  let cleaned = rawResponse.trim();

  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

  // Split on separator marker (---) for multiple suggestions
  const parts = cleaned.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  // Take up to maxSuggestions
  return parts.slice(0, maxSuggestions);
}

/**
 * Escape snippet special characters ($ and })
 */
function escapeSnippet(text: string): string {
  return text.replace(/\$/g, '\\$').replace(/\}/g, '\\}');
}

// ---------------------------------------------------------------------------
// AICompletionProvider
// ---------------------------------------------------------------------------

export class AICompletionProvider {
  private client: CodeBuddyClient | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private config: AICompletionConfig;
  private cache: CompletionCache;
  private _pendingResolve: ((items: CompletionItem[]) => void) | null = null;

  constructor(
    client: CodeBuddyClient | null = null,
    cache?: CompletionCache,
    config?: Partial<AICompletionConfig>,
  ) {
    this.client = client;
    this.config = { ...DEFAULT_AI_COMPLETION_CONFIG, ...config };
    this.cache = cache ?? new CompletionCache({ maxEntries: 100, ttlMs: 5000 });
  }

  /**
   * Set or replace the LLM client (e.g. after config reload)
   */
  setClient(client: CodeBuddyClient | null): void {
    this.client = client;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(partial: Partial<AICompletionConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Get current configuration (readonly)
   */
  getConfig(): Readonly<AICompletionConfig> {
    return this.config;
  }

  /**
   * Provide AI-powered code completions.
   *
   * Returns an array of CompletionItem that can be merged with
   * static completions from the LSP server.
   */
  async provideCompletions(
    fileUri: string,
    position: { line: number; character: number },
    context: AICompletionContext,
    token?: CancellationToken,
  ): Promise<CompletionItem[]> {
    if (!this.config.enabled || !this.client) {
      return [];
    }

    // Skip if prefix is too short (no meaningful context)
    if (context.prefix.trim().length < 2) {
      return [];
    }

    // Check cache first
    const cacheKey = this.buildCacheKey(fileUri, position, context);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as CompletionItem[];
    }

    // Check cancellation before debounce
    if (token?.isCancellationRequested) {
      return [];
    }

    // Debounce: cancel previous pending request
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      // Resolve the previous pending promise with empty results
      if (this._pendingResolve) {
        this._pendingResolve([]);
        this._pendingResolve = null;
      }
    }

    // Wait for debounce period
    const items = await new Promise<CompletionItem[]>((resolve) => {
      this._pendingResolve = resolve;

      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;
        this._pendingResolve = null;

        if (token?.isCancellationRequested) {
          resolve([]);
          return;
        }

        try {
          const result = await this.fetchCompletions(
            fileUri,
            position,
            context,
            token,
          );

          // Cache the result
          if (result.length > 0) {
            this.cache.set(cacheKey, result);
          }

          resolve(result);
        } catch (error) {
          logger.error(`AI completion error: ${error}`);
          resolve([]);
        }
      }, this.config.debounceMs);
    });

    return items;
  }

  /**
   * Cancel any pending debounced request
   */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this._pendingResolve) {
      this._pendingResolve([]);
      this._pendingResolve = null;
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cancel();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildCacheKey(
    fileUri: string,
    position: { line: number; character: number },
    context: AICompletionContext,
  ): string {
    // Use last 80 chars of prefix for cache key stability
    const prefixTail = context.prefix.slice(-80);
    return `ai:${fileUri}:${position.line}:${prefixTail}`;
  }

  private async fetchCompletions(
    fileUri: string,
    position: { line: number; character: number },
    context: AICompletionContext,
    token?: CancellationToken,
  ): Promise<CompletionItem[]> {
    if (!this.client) {
      return [];
    }

    const modelName = this.config.model || this.client.getCurrentModel?.() || '';
    const useFIM = isFIMCapable(modelName);

    let rawResponse: string;

    if (useFIM) {
      // FIM prompt: single message
      const fimPrompt = buildFIMPrompt(context, position);
      const messages: CodeBuddyMessage[] = [
        { role: 'user' as const, content: fimPrompt },
      ];

      const response = await this.client.chat(messages, [], {
        temperature: 0.2,
        model: this.config.model,
      });

      if (token?.isCancellationRequested) return [];

      rawResponse = response.choices[0]?.message?.content || '';
    } else {
      // Standard prompt: system + user messages
      const messages = buildStandardPrompt(context, position);

      const response = await this.client.chat(messages, [], {
        temperature: 0.2,
        model: this.config.model,
      });

      if (token?.isCancellationRequested) return [];

      rawResponse = response.choices[0]?.message?.content || '';
    }

    // Parse response into suggestion strings
    const suggestions = parseCompletionResponse(
      rawResponse,
      this.config.maxSuggestions,
    );

    if (suggestions.length === 0) {
      return [];
    }

    // Convert to CompletionItem[]
    return suggestions.map((text, i) => {
      const isMultiLine = text.includes('\n');

      const item: CompletionItem = {
        label: this.buildLabel(text),
        detail: `AI Completion ${i + 1}/${suggestions.length} ✨ Code Buddy`,
        kind: CompletionItemKind.Snippet,
        // Use snippet format for multi-line to allow tab stops
        insertTextFormat: isMultiLine
          ? InsertTextFormat.Snippet
          : InsertTextFormat.PlainText,
        insertText: isMultiLine ? escapeSnippet(text) + '$0' : text,
        // Sort AI completions after static ones (prefix 'z' sorts last)
        sortText: `zzz_ai_${String(i).padStart(3, '0')}`,
        // Preselect the first suggestion
        preselect: i === 0,
        data: { source: 'ai-completion', index: i },
      };

      return item;
    });
  }

  /**
   * Build a short display label from the completion text.
   * For multi-line completions, show the first line + indicator.
   */
  private buildLabel(text: string): string {
    const lines = text.split('\n');
    const firstLine = (lines[0] ?? '').trim();
    const maxLen = 60;

    if (lines.length > 1) {
      const truncated =
        firstLine.length > maxLen
          ? firstLine.slice(0, maxLen - 3) + '...'
          : firstLine;
      return `${truncated} (+${lines.length - 1} lines)`;
    }

    return firstLine.length > maxLen
      ? firstLine.slice(0, maxLen - 3) + '...'
      : firstLine;
  }
}
