/**
 * Embedding Repository
 *
 * Repository for code embeddings and semantic search.
 */

import type Database from 'better-sqlite3';
import type { CodeEmbedding } from '../schema.js';
import { getDatabaseManager } from '../database-manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Safety cap applied when `find()` is called without an explicit
 * `limit` by a caller that is about to score every candidate for
 * cosine similarity (F34). Without this, `searchSimilar()` pulled
 * the entire embeddings table into JS memory and ran O(N) cosine
 * on projects with tens of thousands of chunks.
 */
const DEFAULT_EMBEDDINGS_LIMIT = 5_000;

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingFilter {
  projectId?: string;
  filePath?: string;
  symbolType?: string;
  symbolName?: string;
  language?: string;
}

export interface EmbeddingSearchResult {
  embedding: CodeEmbedding;
  similarity: number;
}

// ============================================================================
// Embedding Repository
// ============================================================================

export class EmbeddingRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabaseManager().getDatabase();
  }

  /**
   * Create or update code embedding
   */
  upsert(embedding: Omit<CodeEmbedding, 'id' | 'created_at' | 'updated_at'>): CodeEmbedding {
    const stmt = this.db.prepare(`
      INSERT INTO code_embeddings (project_id, file_path, chunk_index, chunk_text, chunk_hash, embedding, symbol_type, symbol_name, start_line, end_line, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, file_path, chunk_index) DO UPDATE SET
        chunk_text = excluded.chunk_text,
        chunk_hash = excluded.chunk_hash,
        embedding = excluded.embedding,
        symbol_type = excluded.symbol_type,
        symbol_name = excluded.symbol_name,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        language = excluded.language,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `);

    const embeddingBlob = Buffer.from(embedding.embedding.buffer);

    const result = stmt.get(
      embedding.project_id,
      embedding.file_path,
      embedding.chunk_index,
      embedding.chunk_text,
      embedding.chunk_hash,
      embeddingBlob,
      embedding.symbol_type || null,
      embedding.symbol_name || null,
      embedding.start_line || null,
      embedding.end_line || null,
      embedding.language || null
    ) as CodeEmbedding & { embedding: Buffer };

    return this.deserializeEmbedding(result);
  }

  /**
   * Bulk upsert embeddings
   */
  bulkUpsert(embeddings: Omit<CodeEmbedding, 'id' | 'created_at' | 'updated_at'>[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO code_embeddings (project_id, file_path, chunk_index, chunk_text, chunk_hash, embedding, symbol_type, symbol_name, start_line, end_line, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, file_path, chunk_index) DO UPDATE SET
        chunk_text = excluded.chunk_text,
        chunk_hash = excluded.chunk_hash,
        embedding = excluded.embedding,
        symbol_type = excluded.symbol_type,
        symbol_name = excluded.symbol_name,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        language = excluded.language,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertMany = this.db.transaction((items: typeof embeddings) => {
      let count = 0;
      for (const embedding of items) {
        const embeddingBlob = Buffer.from(embedding.embedding.buffer);
        stmt.run(
          embedding.project_id,
          embedding.file_path,
          embedding.chunk_index,
          embedding.chunk_text,
          embedding.chunk_hash,
          embeddingBlob,
          embedding.symbol_type || null,
          embedding.symbol_name || null,
          embedding.start_line || null,
          embedding.end_line || null,
          embedding.language || null
        );
        count++;
      }
      return count;
    });

    return insertMany(embeddings);
  }

  /**
   * Get embedding by ID
   */
  getById(id: number): CodeEmbedding | null {
    const stmt = this.db.prepare('SELECT * FROM code_embeddings WHERE id = ?');
    const result = stmt.get(id) as (CodeEmbedding & { embedding: Buffer }) | undefined;

    if (!result) return null;
    return this.deserializeEmbedding(result);
  }

  /**
   * Find embeddings by filter
   */
  find(filter: EmbeddingFilter = {}): CodeEmbedding[] {
    let sql = 'SELECT * FROM code_embeddings WHERE 1=1';
    const params: unknown[] = [];

    if (filter.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    if (filter.filePath) {
      sql += ' AND file_path = ?';
      params.push(filter.filePath);
    }

    if (filter.symbolType) {
      sql += ' AND symbol_type = ?';
      params.push(filter.symbolType);
    }

    if (filter.symbolName) {
      sql += ' AND symbol_name LIKE ?';
      params.push(`%${filter.symbolName}%`);
    }

    if (filter.language) {
      sql += ' AND language = ?';
      params.push(filter.language);
    }

    // F34: always apply a SQL-level LIMIT so `searchSimilar()` cannot
    // accidentally load the entire embeddings table into JS memory.
    // Callers that want to see the full set should page explicitly.
    sql += ' ORDER BY file_path, chunk_index LIMIT ?';
    params.push(DEFAULT_EMBEDDINGS_LIMIT);

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as (CodeEmbedding & { embedding: Buffer })[];

    if (results.length === DEFAULT_EMBEDDINGS_LIMIT) {
      logger.warn(
        `[embedding-repository] find() hit the default cap of ${DEFAULT_EMBEDDINGS_LIMIT} candidates. ` +
        `Narrow the filter (projectId, filePath) or paginate to avoid missing matches.`,
      );
    }

    return results.map(r => this.deserializeEmbedding(r));
  }

  /**
   * Search embeddings by semantic similarity
   */
  searchSimilar(
    queryEmbedding: Float32Array,
    filter: EmbeddingFilter = {},
    topK: number = 10
  ): EmbeddingSearchResult[] {
    // Get candidates matching filter (now always capped by find() — F34)
    const candidates = this.find(filter);

    // Calculate cosine similarity for each
    const results: EmbeddingSearchResult[] = [];

    for (const embedding of candidates) {
      const similarity = this.cosineSimilarity(queryEmbedding, embedding.embedding);
      results.push({ embedding, similarity });
    }

    // Sort by similarity and return top K
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Search embeddings by symbol name
   */
  searchBySymbol(
    symbolName: string,
    filter: EmbeddingFilter = {},
    limit: number = 20
  ): CodeEmbedding[] {
    let sql = `
      SELECT * FROM code_embeddings
      WHERE symbol_name LIKE ?
    `;
    const params: unknown[] = [`%${symbolName}%`];

    if (filter.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    if (filter.symbolType) {
      sql += ' AND symbol_type = ?';
      params.push(filter.symbolType);
    }

    if (filter.language) {
      sql += ' AND language = ?';
      params.push(filter.language);
    }

    sql += ' ORDER BY LENGTH(symbol_name) ASC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as (CodeEmbedding & { embedding: Buffer })[];

    return results.map(r => this.deserializeEmbedding(r));
  }

  /**
   * Delete embeddings for file
   */
  deleteForFile(projectId: string, filePath: string): number {
    const stmt = this.db.prepare('DELETE FROM code_embeddings WHERE project_id = ? AND file_path = ?');
    const result = stmt.run(projectId, filePath);
    return result.changes;
  }

  /**
   * Delete embeddings for project
   */
  deleteForProject(projectId: string): number {
    const stmt = this.db.prepare('DELETE FROM code_embeddings WHERE project_id = ?');
    const result = stmt.run(projectId);
    return result.changes;
  }

  /**
   * Delete stale embeddings (files that no longer exist)
   */
  deleteStale(projectId: string, existingFiles: string[]): number {
    if (existingFiles.length === 0) {
      return this.deleteForProject(projectId);
    }

    const placeholders = existingFiles.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      DELETE FROM code_embeddings
      WHERE project_id = ? AND file_path NOT IN (${placeholders})
    `);
    const result = stmt.run(projectId, ...existingFiles);
    return result.changes;
  }

  /**
   * Check if file needs re-indexing
   */
  needsReindex(projectId: string, filePath: string, contentHash: string): boolean {
    const stmt = this.db.prepare(`
      SELECT chunk_hash FROM code_embeddings
      WHERE project_id = ? AND file_path = ? AND chunk_index = 0
      LIMIT 1
    `);
    const result = stmt.get(projectId, filePath) as { chunk_hash: string } | undefined;

    if (!result) return true;
    return result.chunk_hash !== contentHash;
  }

  /**
   * Get embedding statistics
   */
  getStats(projectId?: string): {
    totalEmbeddings: number;
    totalFiles: number;
    byLanguage: Record<string, number>;
    bySymbolType: Record<string, number>;
  } {
    let whereClause = '';
    const params: unknown[] = [];

    if (projectId) {
      whereClause = ' WHERE project_id = ?';
      params.push(projectId);
    }

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM code_embeddings${whereClause}`).get(...params) as { count: number }).count;

    const files = (this.db.prepare(`SELECT COUNT(DISTINCT file_path) as count FROM code_embeddings${whereClause}`).get(...params) as { count: number }).count;

    const languageRows = this.db.prepare(`
      SELECT language, COUNT(*) as count FROM code_embeddings${whereClause}
      GROUP BY language
    `).all(...params) as { language: string | null; count: number }[];

    const byLanguage: Record<string, number> = {};
    for (const row of languageRows) {
      byLanguage[row.language || 'unknown'] = row.count;
    }

    const symbolRows = this.db.prepare(`
      SELECT symbol_type, COUNT(*) as count FROM code_embeddings${whereClause}
      GROUP BY symbol_type
    `).all(...params) as { symbol_type: string | null; count: number }[];

    const bySymbolType: Record<string, number> = {};
    for (const row of symbolRows) {
      bySymbolType[row.symbol_type || 'unknown'] = row.count;
    }

    return {
      totalEmbeddings: total,
      totalFiles: files,
      byLanguage,
      bySymbolType,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private deserializeEmbedding(row: Omit<CodeEmbedding, 'embedding'> & { embedding: Buffer }): CodeEmbedding {
    const buf = row.embedding as Buffer;
    return {
      ...row,
      embedding: new Float32Array(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      ),
    };
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: EmbeddingRepository | null = null;

export function getEmbeddingRepository(): EmbeddingRepository {
  if (!instance) {
    instance = new EmbeddingRepository();
  }
  return instance;
}

export function resetEmbeddingRepository(): void {
  instance = null;
}
