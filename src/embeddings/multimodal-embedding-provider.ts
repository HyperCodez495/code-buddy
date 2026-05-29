/**
 * Multimodal Embedding Provider
 *
 * Supports text + image embeddings in the same vector space using
 * Google's Gemini embedding model (gemini-embedding-2-preview).
 * This enables cross-modal search: find images by text queries and vice versa.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingInput {
  type: 'text' | 'image';
  /** Text content or base64-encoded image data */
  content: string;
  /** For images: 'image/png', 'image/jpeg', etc. */
  mimeType?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  inputType: 'text' | 'image';
  dimensions: number;
}

export interface MultimodalEmbeddingConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

interface GeminiEmbedRequest {
  requests: GeminiEmbedContentRequest[];
}

interface GeminiEmbedContentRequest {
  model: string;
  content: {
    parts: GeminiPart[];
  };
  outputDimensionality?: number;
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

interface GeminiEmbedResponse {
  embeddings: {
    values: number[];
  }[];
}

// ============================================================================
// Provider
// ============================================================================

export class MultimodalEmbeddingProvider {
  private config: Required<MultimodalEmbeddingConfig>;

  constructor(config: MultimodalEmbeddingConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gemini-embedding-2-preview',
      dimensions: config.dimensions || 768,
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
    };
  }

  /**
   * Embed a batch of text and/or image inputs into a shared vector space.
   */
  async embed(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const modelPath = `models/${this.config.model}`;
    const url = `${this.config.baseUrl}/${modelPath}:batchEmbedContents?key=${this.config.apiKey}`;

    const requests: GeminiEmbedContentRequest[] = inputs.map((input) => {
      const parts: GeminiPart[] = [];

      if (input.type === 'text') {
        parts.push({ text: input.content });
      } else {
        parts.push({
          inline_data: {
            mime_type: input.mimeType || 'image/png',
            data: input.content,
          },
        });
      }

      return {
        model: modelPath,
        content: { parts },
        outputDimensionality: this.config.dimensions,
      };
    });

    const body: GeminiEmbedRequest = { requests };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Multimodal embedding request failed', { error: message });
      throw new Error(`Multimodal embedding network error: ${message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Multimodal embedding API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(
        `Multimodal embedding API error (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as GeminiEmbedResponse;

    if (!data.embeddings || data.embeddings.length !== inputs.length) {
      throw new Error(
        `Unexpected embedding response: expected ${inputs.length} embeddings, got ${data.embeddings?.length ?? 0}`
      );
    }

    return data.embeddings.map((emb, i) => {
      const input = inputs[i];
      if (input === undefined) {
        throw new Error(
          `Unexpected embedding response: missing input for embedding at index ${i}`
        );
      }
      return {
        embedding: emb.values,
        inputType: input.type,
        dimensions: emb.values.length,
      };
    });
  }

  /**
   * Embed a single text string.
   */
  async embedText(text: string): Promise<number[]> {
    const results = await this.embed([{ type: 'text', content: text }]);
    const first = results[0];
    if (first === undefined) {
      throw new Error('Multimodal embedding returned no result for text input');
    }
    return first.embedding;
  }

  /**
   * Embed a single image (base64-encoded).
   */
  async embedImage(
    base64Data: string,
    mimeType: string = 'image/png'
  ): Promise<number[]> {
    const results = await this.embed([
      { type: 'image', content: base64Data, mimeType },
    ]);
    const first = results[0];
    if (first === undefined) {
      throw new Error('Multimodal embedding returned no result for image input');
    }
    return first.embedding;
  }

  /**
   * Return the configured dimensionality.
   */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Return the model name.
   */
  getModel(): string {
    return this.config.model;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: MultimodalEmbeddingProvider | null = null;

/**
 * Get (or create) the singleton multimodal embedding provider.
 * Returns null when no Gemini/Google API key is available.
 */
export function getMultimodalEmbeddingProvider(): MultimodalEmbeddingProvider | null {
  if (!_instance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;
    _instance = new MultimodalEmbeddingProvider({ apiKey });
  }
  return _instance;
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetMultimodalEmbeddingProvider(): void {
  _instance = null;
}
