/**
 * Cross-Modal Search
 *
 * Finds images by text queries and text memories by image similarity.
 * Leverages multimodal embeddings (Gemini) to project text and images
 * into the same vector space: "find screenshots of login form" returns
 * matching images ranked by cosine similarity.
 *
 * Aggregates results from:
 * - OCR Memory Pipeline (screenshot/image entries)
 * - Enhanced Memory / Persistent Memory (text entries)
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface CrossModalResult {
  type: 'text' | 'image';
  /** File path (for images) */
  path?: string;
  /** Text content (for text results, or extracted OCR text for images) */
  content?: string;
  /** Similarity score (0..1) */
  score: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface CrossModalSearchOptions {
  /** Maximum results to return (default: 10) */
  limit?: number;
  /** Filter by result type */
  types?: ('text' | 'image')[];
  /** Minimum similarity threshold (default: 0.1) */
  minScore?: number;
}

// ============================================================================
// Cross-Modal Search
// ============================================================================

export class CrossModalSearch {
  /**
   * Search across text memories and OCR-indexed images using
   * multimodal embeddings for cross-modal retrieval.
   */
  async search(
    query: string,
    options: CrossModalSearchOptions = {}
  ): Promise<CrossModalResult[]> {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.1;
    const allowedTypes = options.types ?? ['text', 'image'];

    const results: CrossModalResult[] = [];

    // Generate query embedding
    let queryEmbedding: number[] | undefined;
    try {
      const { getMultimodalEmbeddingProvider } = await import(
        '../embeddings/multimodal-embedding-provider.js'
      );
      const provider = getMultimodalEmbeddingProvider();
      if (provider) {
        queryEmbedding = await provider.embedText(query);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('Multimodal embedding not available for cross-modal search', {
        error: msg,
      });
    }

    // 1. Search images (OCR Memory Pipeline)
    if (allowedTypes.includes('image')) {
      try {
        const imageResults = await this.searchImages(
          query,
          queryEmbedding,
          limit,
          minScore
        );
        results.push(...imageResults);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug('Image search failed', { error: msg });
      }
    }

    // 2. Search text memories
    if (allowedTypes.includes('text')) {
      try {
        const textResults = await this.searchText(
          query,
          queryEmbedding,
          limit,
          minScore
        );
        results.push(...textResults);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug('Text memory search failed', { error: msg });
      }
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ==========================================================================
  // Private: Image Search
  // ==========================================================================

  private async searchImages(
    query: string,
    queryEmbedding: number[] | undefined,
    limit: number,
    minScore: number
  ): Promise<CrossModalResult[]> {
    const { getOCRMemoryPipeline } = await import('./ocr-memory-pipeline.js');
    const pipeline = getOCRMemoryPipeline();
    const entries = pipeline.getAllEntries();

    if (entries.length === 0) return [];

    // Embedding-based search if available
    if (queryEmbedding) {
      const scored = entries
        .filter((e) => e.embedding && e.embedding.length > 0)
        .map((entry) => ({
          entry,
          score: cosineSimilarity(queryEmbedding!, entry.embedding!),
        }))
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length > 0) {
        return scored.map((s) => ({
          type: 'image' as const,
          path: s.entry.sourcePath,
          content: s.entry.extractedText || undefined,
          score: s.score,
          metadata: {
            id: s.entry.id,
            timestamp: s.entry.timestamp,
            sourceType: s.entry.metadata.sourceType,
            ocrConfidence: s.entry.metadata.ocrConfidence,
          },
        }));
      }
    }

    // Fallback: text search on extracted OCR text
    const queryLower = query.toLowerCase();
    const terms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    return entries
      .map((entry) => {
        const text = entry.extractedText.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) score += 1;
        }
        if (text.includes(queryLower)) score += terms.length;
        // Normalize to 0..1 range
        const maxScore = terms.length * 2;
        const normalized = maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
        return { entry, score: normalized };
      })
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({
        type: 'image' as const,
        path: s.entry.sourcePath,
        content: s.entry.extractedText || undefined,
        score: s.score,
        metadata: {
          id: s.entry.id,
          timestamp: s.entry.timestamp,
          sourceType: s.entry.metadata.sourceType,
        },
      }));
  }

  // ==========================================================================
  // Private: Text Memory Search
  // ==========================================================================

  private async searchText(
    query: string,
    queryEmbedding: number[] | undefined,
    limit: number,
    minScore: number
  ): Promise<CrossModalResult[]> {
    const results: CrossModalResult[] = [];

    // Try semantic memory search
    try {
      const { getSemanticMemorySearch } = await import(
        './semantic-memory-search.js'
      );
      const semanticSearch = getSemanticMemorySearch();
      const searchResults = await semanticSearch.search(query, { maxResults: limit });

      for (const sr of searchResults) {
        const score = sr.score ?? 0.5;
        if (score >= minScore) {
          results.push({
            type: 'text',
            content: sr.snippet || sr.entry?.content || '',
            score,
            metadata: {
              source: sr.entry?.metadata?.source,
              matchedTerms: sr.matchedTerms,
            },
          });
        }
      }
    } catch {
      // Semantic search unavailable, try persistent memory
    }

    // Persistent memory fallback — recall is key-based, not search-based,
    // so we only attempt a direct lookup if the query looks like a key.
    if (results.length < limit) {
      try {
        const { getMemoryManager } = await import('./persistent-memory.js');
        const manager = getMemoryManager();
        const recalled = manager.recall(query);
        if (recalled) {
          const isDuplicate = results.some((r) => r.content === recalled);
          if (!isDuplicate) {
            results.push({
              type: 'text',
              content: recalled,
              score: 0.4,
              metadata: { source: 'persistent-memory' },
            });
          }
        }
      } catch {
        // Persistent memory unavailable
      }
    }

    return results.slice(0, limit);
  }
}

// ============================================================================
// Utility: Cosine Similarity
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    // safe: loop bound is a.length and the guard above ensures a.length === b.length, so both indices are in range
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) continue;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: CrossModalSearch | null = null;

export function getCrossModalSearch(): CrossModalSearch {
  if (!_instance) {
    _instance = new CrossModalSearch();
  }
  return _instance;
}

export function resetCrossModalSearch(): void {
  _instance = null;
}
