/**
 * Presence Store — persistent JSON store of human identities.
 *
 * Holds {name, aliases, faceEmbeddingAvg, snapshots} per known person.
 * Atomic on-disk format: `<userData>/presence-store.json` (tmp + rename
 * so a partial flush can never corrupt the live file).
 *
 * Cosine matching done in-memory with simple linear scan — V0 expects
 * ≤10 enrolled identities, so usearch / FAISS is overkill.
 *
 * @module cowork/main/presence/presence-store
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { log, logError, logWarn } from '../utils/logger';
import type {
  FaceEmbedding,
  PersonIdentity,
  PresenceMatch,
} from './types';

/** Filename inside `app.getPath('userData')`. */
const STORE_FILENAME = 'presence-store.json';

/** Schema version — bump when the on-disk format changes. */
const SCHEMA_VERSION = 1;

interface StoreFile {
  version: number;
  updatedAt: number;
  persons: SerializedPerson[];
}

/**
 * On-disk shape of a person — `Float32Array` is serialised as a regular
 * `number[]` so the file stays human-readable JSON. Conversion happens at
 * load/save time, never visible to consumers.
 */
interface SerializedPerson {
  id: string;
  name: string;
  aliases: string[];
  faceEmbeddingAvg: number[];
  faceSampleCount: number;
  voiceEmbeddingAvg?: number[];
  voiceSampleCount?: number;
  snapshotPaths: string[];
  createdAt: number;
  updatedAt: number;
}

function toSerialized(p: PersonIdentity): SerializedPerson {
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases,
    faceEmbeddingAvg: Array.from(p.faceEmbeddingAvg),
    faceSampleCount: p.faceSampleCount,
    voiceEmbeddingAvg: p.voiceEmbeddingAvg
      ? Array.from(p.voiceEmbeddingAvg)
      : undefined,
    voiceSampleCount: p.voiceSampleCount,
    snapshotPaths: p.snapshotPaths,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function fromSerialized(s: SerializedPerson): PersonIdentity {
  return {
    id: s.id,
    name: s.name,
    aliases: s.aliases,
    faceEmbeddingAvg: Float32Array.from(s.faceEmbeddingAvg),
    faceSampleCount: s.faceSampleCount,
    voiceEmbeddingAvg: s.voiceEmbeddingAvg
      ? Float32Array.from(s.voiceEmbeddingAvg)
      : undefined,
    voiceSampleCount: s.voiceSampleCount,
    snapshotPaths: s.snapshotPaths,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function cosineSimilarity(a: FaceEmbedding, b: FaceEmbedding): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Incrementally update an averaged embedding. Equivalent to recomputing
 * `(sum_old + new) / (count_old + 1)` but works with the already-averaged
 * vector instead of keeping every sample around.
 */
function rollingAverage(
  current: FaceEmbedding,
  currentCount: number,
  next: FaceEmbedding,
): FaceEmbedding {
  const result = new Float32Array(current.length);
  const newCount = currentCount + 1;
  for (let i = 0; i < current.length; i++) {
    result[i] = (current[i] * currentCount + next[i]) / newCount;
  }
  return result;
}

export class PresenceStore {
  private storePath: string;
  private persons: Map<string, PersonIdentity> = new Map();
  private loaded = false;

  constructor(customStoreDir?: string) {
    const baseDir = customStoreDir ?? app.getPath('userData');
    this.storePath = path.join(baseDir, STORE_FILENAME);
  }

  /** Load the store from disk. Idempotent. Returns silently on first-run (no file). */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoreFile;
      if (parsed.version !== SCHEMA_VERSION) {
        logWarn(
          `[PresenceStore] schema version mismatch: file=${parsed.version}, expected=${SCHEMA_VERSION}. Ignoring file.`,
        );
        this.loaded = true;
        return;
      }
      for (const sp of parsed.persons) {
        this.persons.set(sp.id, fromSerialized(sp));
      }
      log(`[PresenceStore] Loaded ${this.persons.size} identities from ${this.storePath}`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') {
        log(`[PresenceStore] No store file yet at ${this.storePath} (first run).`);
      } else {
        logError(`[PresenceStore] Failed to load: ${(err as Error).message}`);
      }
    }
    this.loaded = true;
  }

  /** Atomic save (tmp + rename). Throws on I/O error so the caller can react. */
  async save(): Promise<void> {
    const file: StoreFile = {
      version: SCHEMA_VERSION,
      updatedAt: Date.now(),
      persons: Array.from(this.persons.values()).map(toSerialized),
    };
    const json = JSON.stringify(file, null, 2);
    const tmp = `${this.storePath}.tmp`;
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(tmp, json, 'utf-8');
    await fs.rename(tmp, this.storePath);
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  /**
   * Create a new identity. Returns the freshly-minted person. Aliases is
   * the optional list of register variants ("mon chéri", "patron", …) the
   * LLM can pick from when greeting.
   */
  async addPerson(
    name: string,
    aliases: string[] = [],
    initialEmbedding?: FaceEmbedding,
    snapshotPath?: string,
  ): Promise<PersonIdentity> {
    await this.load();
    const id = crypto.randomUUID();
    const now = Date.now();
    const dim = initialEmbedding?.length ?? 512;
    const person: PersonIdentity = {
      id,
      name: name.trim(),
      aliases: aliases.map((a) => a.trim()).filter(Boolean),
      faceEmbeddingAvg: initialEmbedding ?? new Float32Array(dim),
      faceSampleCount: initialEmbedding ? 1 : 0,
      snapshotPaths: snapshotPath ? [snapshotPath] : [],
      createdAt: now,
      updatedAt: now,
    };
    this.persons.set(id, person);
    await this.save();
    log(`[PresenceStore] Added person ${name} (id=${id})`);
    return person;
  }

  /** Append a new face sample to an existing identity. Updates the rolling average. */
  async addFaceSample(
    personId: string,
    embedding: FaceEmbedding,
    snapshotPath?: string,
  ): Promise<PersonIdentity> {
    await this.load();
    const person = this.persons.get(personId);
    if (!person) {
      throw new Error(`PresenceStore: person ${personId} not found`);
    }
    if (person.faceSampleCount === 0) {
      // First real sample replaces the zero placeholder.
      person.faceEmbeddingAvg = embedding;
      person.faceSampleCount = 1;
    } else {
      person.faceEmbeddingAvg = rollingAverage(
        person.faceEmbeddingAvg,
        person.faceSampleCount,
        embedding,
      );
      person.faceSampleCount += 1;
    }
    if (snapshotPath) person.snapshotPaths.push(snapshotPath);
    person.updatedAt = Date.now();
    await this.save();
    return person;
  }

  /** Remove a person entirely. Returns true if the id existed, false otherwise. */
  async removePerson(personId: string): Promise<boolean> {
    await this.load();
    const existed = this.persons.delete(personId);
    if (existed) await this.save();
    return existed;
  }

  /** Snapshot of all enrolled identities. */
  async listPersons(): Promise<PersonIdentity[]> {
    await this.load();
    return Array.from(this.persons.values());
  }

  // ─── Matching ────────────────────────────────────────────────────

  /**
   * Cosine top-1 match. Returns null if no identity meets `threshold`,
   * otherwise the closest match with its confidence.
   */
  async match(
    embedding: FaceEmbedding,
    threshold = 0.5,
  ): Promise<PresenceMatch | null> {
    await this.load();
    let best: PersonIdentity | null = null;
    let bestScore = -Infinity;
    for (const person of this.persons.values()) {
      if (person.faceSampleCount === 0) continue;
      const score = cosineSimilarity(embedding, person.faceEmbeddingAvg);
      if (score > bestScore) {
        bestScore = score;
        best = person;
      }
    }
    if (!best || bestScore < threshold) return null;
    return {
      personId: best.id,
      name: best.name,
      aliases: best.aliases,
      confidence: bestScore,
      matchedAt: Date.now(),
    };
  }

  /** Path to the on-disk store, exposed for diagnostics / debug UI. */
  getStorePath(): string {
    return this.storePath;
  }
}

let singleton: PresenceStore | null = null;
export function getPresenceStore(): PresenceStore {
  if (singleton === null) singleton = new PresenceStore();
  return singleton;
}
