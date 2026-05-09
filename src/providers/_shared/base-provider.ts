/**
 * @phuetz/ai-providers — Base Provider
 *
 * Abstract base class for AI providers.
 * Defines the contract that all LLM providers must fulfill.
 */

import { EventEmitter } from 'events';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ProviderFeature,
  LLMMessage,
  ProviderPricing,
} from './types.js';

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface representing a generic AI Provider.
 * Abstracts differences between LLM APIs (OpenAI, Anthropic, Gemini, xAI, etc.).
 */
export interface AIProvider {
  /** Unique identifier for the provider type. */
  readonly type: ProviderType;
  /** Display name. */
  readonly name: string;
  /** Default model ID. */
  readonly defaultModel: string;

  /** Initialize with configuration (API key, model, etc.). */
  initialize(config: ProviderConfig): Promise<void>;
  /** Check if provider is ready. */
  isReady(): boolean;
  /** Send a chat completion request (non-streaming). */
  chat(options: CompletionOptions): Promise<LLMResponse>;
  /** Send a streaming chat completion request. */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;
  /** Get available models. */
  getModels(): Promise<string[]>;
  /** Check if a feature is supported. */
  supports(feature: ProviderFeature): boolean;
  /** Estimate token count for content. */
  estimateTokens(content: string | LLMMessage[]): number;
  /** Get pricing info. */
  getPricing(): ProviderPricing;
  /** Clean up resources. */
  dispose(): void;
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

/**
 * Abstract base class with common functionality for AI providers.
 * Concrete providers should extend this class.
 */
export abstract class BaseProvider extends EventEmitter implements AIProvider {
  abstract readonly type: ProviderType;
  abstract readonly name: string;
  abstract readonly defaultModel: string;

  protected config: ProviderConfig | null = null;
  protected ready = false;

  /**
   * Initialize the provider.
   * Validates config and emits 'ready' event.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.validateConfig();
    this.ready = true;
    this.emit('ready');
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Validate configuration.
   * Override in subclasses for specific validation.
   */
  protected async validateConfig(): Promise<void> {
    if (!this.config?.apiKey) {
      // Local providers might not need API key
      if (this.type !== 'ollama' && this.type !== 'lm-studio' && this.type !== 'local') {
        throw new Error(`${this.name} API key is required`);
      }
    }
  }

  /**
   * Chat completion with optional latency tracking.
   * Delegates to abstract complete() method.
   */
  async chat(options: CompletionOptions): Promise<LLMResponse> {
    return this.complete(options);
  }

  /**
   * Abstract: perform the actual completion request.
   */
  protected abstract complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Abstract: perform streaming completion.
   */
  abstract stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  async getModels(): Promise<string[]> {
    return [this.defaultModel];
  }

  supports(feature: ProviderFeature): boolean {
    switch (feature) {
      case 'streaming':
      case 'tools':
      case 'function_calling':
        return true;
      case 'vision':
      case 'json_mode':
        return false;
      default:
        return false;
    }
  }

  estimateTokens(content: string | LLMMessage[]): number {
    const text = typeof content === 'string'
      ? content
      : content.map(m => m.content ?? '').join(' ');
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  abstract getPricing(): ProviderPricing;

  dispose(): void {
    this.ready = false;
    this.config = null;
    this.removeAllListeners();
  }
}
