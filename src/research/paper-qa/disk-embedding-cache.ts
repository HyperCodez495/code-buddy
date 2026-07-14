/**
 * Bounded, process-persistent embedding cache for PaperQA passages.
 *
 * Each vector is an atomic, small binary file sharded by the first two
 * fingerprint characters. Corrupt entries are discarded and every filesystem
 * failure degrades to a cache miss: research must remain usable on read-only or
 * damaged profiles.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EmbeddingCache } from './passage-index.js';

const MAGIC = 'CBV1';
const HEADER_BYTES = 8;
const DEFAULT_MAX_ENTRIES = 20_000;
const MAX_VECTOR_DIMENSIONS = 65_536;
const FINGERPRINT_PATTERN = /^[a-f0-9]{40}$/;

export interface DiskEmbeddingCacheOptions {
  directory?: string;
  maxEntries?: number;
}

interface CacheEntry {
  path: string;
  touchedAt: number;
}

export class DiskEmbeddingCache implements EmbeddingCache {
  private readonly directory: string;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: DiskEmbeddingCacheOptions = {}) {
    this.directory =
      options.directory ??
      process.env.CODEBUDDY_PAPER_QA_CACHE_DIR ??
      join(homedir(), '.codebuddy', 'paper-qa', 'embeddings');
    this.maxEntries = clampMaxEntries(options.maxEntries);
    this.hydrateIndex();
    this.evictOverflow();
  }

  get(fingerprint: string): Float32Array | undefined {
    if (!FINGERPRINT_PATTERN.test(fingerprint)) return undefined;
    const entry = this.entries.get(fingerprint) ?? this.discoverEntry(fingerprint);
    if (!entry) return undefined;

    try {
      const vector = decodeVector(readFileSync(entry.path));
      const now = Date.now();
      this.entries.set(fingerprint, { path: entry.path, touchedAt: now });
      try {
        const date = new Date(now);
        utimesSync(entry.path, date, date);
      } catch {
        // Touching is an LRU optimization only; the vector is still valid.
      }
      return vector;
    } catch {
      this.removeEntry(fingerprint, entry.path);
      return undefined;
    }
  }

  set(fingerprint: string, vector: Float32Array): void {
    if (!FINGERPRINT_PATTERN.test(fingerprint) || !isValidVector(vector)) return;
    if (this.entries.has(fingerprint) || this.discoverEntry(fingerprint)) return;

    try {
      this.evictToFitOne();
      const target = this.pathFor(fingerprint);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        writeFileSync(temporary, encodeVector(vector), { flag: 'wx' });
        renameSync(temporary, target);
      } catch (error) {
        try {
          rmSync(temporary, { force: true });
        } catch {
          // Best-effort cleanup.
        }
        throw error;
      }
      this.entries.set(fingerprint, { path: target, touchedAt: Date.now() });
    } catch {
      // A cache write must never make indexing fail.
    }
  }

  private hydrateIndex(): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      for (const shard of readdirSync(this.directory, { withFileTypes: true })) {
        if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
        const shardPath = join(this.directory, shard.name);
        for (const file of readdirSync(shardPath, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith('.f32')) continue;
          const fingerprint = file.name.slice(0, -4);
          if (!FINGERPRINT_PATTERN.test(fingerprint) || !fingerprint.startsWith(shard.name)) {
            continue;
          }
          const path = join(shardPath, file.name);
          try {
            this.entries.set(fingerprint, { path, touchedAt: statSync(path).mtimeMs });
          } catch {
            // Entry disappeared during discovery.
          }
        }
      }
    } catch {
      // Read-only or unavailable cache directory: operate as an empty cache.
    }
  }

  private discoverEntry(fingerprint: string): CacheEntry | undefined {
    const path = this.pathFor(fingerprint);
    try {
      const entry = { path, touchedAt: statSync(path).mtimeMs };
      this.entries.set(fingerprint, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) this.evictOldest();
  }

  private evictToFitOne(): void {
    while (this.entries.size >= this.maxEntries) this.evictOldest();
  }

  private evictOldest(): void {
    let oldestFingerprint: string | undefined;
    let oldest: CacheEntry | undefined;
    for (const [fingerprint, entry] of this.entries) {
      if (!oldest || entry.touchedAt < oldest.touchedAt) {
        oldestFingerprint = fingerprint;
        oldest = entry;
      }
    }
    if (!oldestFingerprint || !oldest) return;
    this.removeEntry(oldestFingerprint, oldest.path);
  }

  private removeEntry(fingerprint: string, path: string): void {
    this.entries.delete(fingerprint);
    try {
      rmSync(path, { force: true });
    } catch {
      // Best-effort eviction/corruption cleanup.
    }
  }

  private pathFor(fingerprint: string): string {
    return join(this.directory, fingerprint.slice(0, 2), `${fingerprint}.f32`);
  }
}

function encodeVector(vector: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(HEADER_BYTES + vector.length * Float32Array.BYTES_PER_ELEMENT);
  buffer.write(MAGIC, 0, 'ascii');
  buffer.writeUInt32LE(vector.length, 4);
  for (let index = 0; index < vector.length; index++) {
    buffer.writeFloatLE(vector[index]!, HEADER_BYTES + index * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer;
}

function decodeVector(buffer: Buffer): Float32Array {
  if (buffer.length < HEADER_BYTES || buffer.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error('Invalid embedding cache header');
  }
  const dimensions = buffer.readUInt32LE(4);
  const expectedBytes = HEADER_BYTES + dimensions * Float32Array.BYTES_PER_ELEMENT;
  if (dimensions === 0 || dimensions > MAX_VECTOR_DIMENSIONS || buffer.length !== expectedBytes) {
    throw new Error('Invalid embedding cache dimensions');
  }
  const vector = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index++) {
    const value = buffer.readFloatLE(HEADER_BYTES + index * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(value)) throw new Error('Invalid embedding cache value');
    vector[index] = value;
  }
  return vector;
}

function isValidVector(vector: Float32Array): boolean {
  if (vector.length === 0 || vector.length > MAX_VECTOR_DIMENSIONS) return false;
  return vector.every((value) => Number.isFinite(value));
}

function clampMaxEntries(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ENTRIES;
  return Math.min(200_000, Math.max(1, Math.floor(value)));
}
