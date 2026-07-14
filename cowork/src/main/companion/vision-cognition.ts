import { randomUUID } from 'node:crypto';
import { loadCoreModule } from '../utils/core-loader';
import { logWarn } from '../utils/logger';

const SENSOR_ID = 'cowork-companion-camera';
const MAX_FACES = 8;
const MAX_TRACK_MISSES = 1;

interface Box2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Detection {
  box2d: Box2D;
  confidence: number;
}

interface AnonymousTrack extends Detection {
  episodeId: string;
  misses: number;
}

interface CognitiveVisionConnection {
  readonly isReady: boolean;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(draft: Record<string, unknown>): Promise<unknown>;
}

interface CognitiveBusClientModule {
  CognitiveBusClient: new (options: Record<string, unknown>) => CognitiveVisionConnection;
}

export interface CoworkRendererVisionSnapshot {
  width?: unknown;
  height?: unknown;
  mediaPipe?: unknown;
}

export interface CoworkVisionPublishResult {
  cameraPublished: boolean;
  facesPublished: number;
  lossesPublished: number;
}

function cognitiveWsUrl(): string {
  return process.env.CODEBUDDY_COGNITIVE_WS_URL?.trim() || 'ws://127.0.0.1:3055/ws';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Extracts only normalized face boxes and confidence from the untrusted renderer object. */
export function extractSafeFaceDetections(input: CoworkRendererVisionSnapshot): Detection[] | null {
  const width = finitePositive(input.width);
  const height = finitePositive(input.height);
  const analysis = asRecord(input.mediaPipe);
  if (!width || !height || !analysis || analysis.status !== 'ok') return null;
  const rawFaces = Array.isArray(analysis.faces) ? analysis.faces.slice(0, MAX_FACES) : [];
  const detections: Detection[] = [];
  for (const rawFace of rawFaces) {
    const face = asRecord(rawFace);
    const rawBox = asRecord(face?.boundingBox);
    if (!face || !rawBox) continue;
    const x = typeof rawBox.x === 'number' && Number.isFinite(rawBox.x) ? rawBox.x : NaN;
    const y = typeof rawBox.y === 'number' && Number.isFinite(rawBox.y) ? rawBox.y : NaN;
    const boxWidth = finitePositive(rawBox.width);
    const boxHeight = finitePositive(rawBox.height);
    const confidence = typeof face.confidence === 'number' && Number.isFinite(face.confidence)
      ? face.confidence
      : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !boxWidth || !boxHeight) continue;
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) continue;
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(width, x + boxWidth);
    const bottom = Math.min(height, y + boxHeight);
    if (right <= left || bottom <= top) continue;
    const box2d = {
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
    };
    if (box2d.x + box2d.width > 1 || box2d.y + box2d.height > 1) continue;
    detections.push({ box2d, confidence });
  }
  return detections.sort((a, b) =>
    a.box2d.x - b.box2d.x ||
    a.box2d.y - b.box2d.y ||
    a.box2d.width - b.box2d.width ||
    a.box2d.height - b.box2d.height
  );
}

function intersectionOverUnion(a: Box2D, b: Box2D): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function correlationId(sequence: number): string {
  return `cowork-vision:${Date.now()}:${sequence}`;
}

/**
 * Main-process bridge from one-shot MediaPipe frames to the shared brain.
 * It never forwards the image, paths, landmarks, keypoints or renderer IDs.
 */
export class CoworkVisionCognition {
  private client: CognitiveVisionConnection | null;
  private readonly tracks = new Map<string, AnonymousTrack>();
  private connectPromise: Promise<void> | null = null;
  private publishQueue: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(client?: CognitiveVisionConnection) {
    this.client = client ?? null;
    if (this.client) this.attachErrorListener(this.client);
  }

  private attachErrorListener(client: CognitiveVisionConnection): void {
    client.on('error', (error: unknown) => {
      logWarn(
        '[CoworkVisionCognition] background connection error:',
        error instanceof Error ? error.message : String(error)
      );
    });
  }

  publishSnapshot(input: CoworkRendererVisionSnapshot): Promise<CoworkVisionPublishResult> {
    if (process.env.CODEBUDDY_COWORK_VISION_COGNITION === 'false') {
      return Promise.resolve({ cameraPublished: false, facesPublished: 0, lossesPublished: 0 });
    }
    // Parse before queueing so the raw renderer object is neither retained nor
    // able to change while awaiting an earlier frame.
    const detections = extractSafeFaceDetections(input);
    const operation = this.publishQueue.then(() => this.publishDetections(detections));
    this.publishQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async publishDetections(
    detections: Detection[] | null
  ): Promise<CoworkVisionPublishResult> {
    try {
      await this.ensureConnected();
      const observedAt = Date.now();
      await this.publish('camera_alive', observedAt, 1);
      if (detections === null) {
        return { cameraPublished: true, facesPublished: 0, lossesPublished: 0 };
      }
      const { active, lost } = this.updateTracks(detections);
      const visibleCount = active.length;
      for (const track of active) {
        await this.publish('person_observed', observedAt, track.confidence, {
          presenceEpisodeId: track.episodeId,
          occupancyCount: visibleCount,
          box2d: track.box2d,
        });
      }
      // A missing detector track means uncertainty, never physical departure.
      // Do not let one vanished track override aggregate evidence that other
      // people remain visible. Such tracks simply expire to unknown.
      if (active.length === 0) {
        for (const track of lost) {
          await this.publish('person_lost', observedAt, 0, {
            presenceEpisodeId: track.episodeId,
          });
        }
      }
      return {
        cameraPublished: true,
        facesPublished: active.length,
        lossesPublished: active.length === 0 ? lost.length : 0,
      };
    } catch (error) {
      logWarn(
        '[CoworkVisionCognition] shared perception unavailable:',
        error instanceof Error ? error.message : String(error)
      );
      return { cameraPublished: false, facesPublished: 0, lossesPublished: 0 };
    }
  }

  async close(): Promise<void> {
    await this.publishQueue;
    await this.client?.disconnect();
  }

  private updateTracks(detections: Detection[]): {
    active: AnonymousTrack[];
    lost: AnonymousTrack[];
  } {
    const previous = [...this.tracks.values()].sort((a, b) =>
      a.episodeId.localeCompare(b.episodeId)
    );
    const candidates: Array<{ trackIndex: number; detectionIndex: number; iou: number }> = [];
    for (let trackIndex = 0; trackIndex < previous.length; trackIndex += 1) {
      for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex += 1) {
        const track = previous[trackIndex];
        const detection = detections[detectionIndex];
        if (!track || !detection) continue;
        const iou = intersectionOverUnion(track.box2d, detection.box2d);
        if (iou >= 0.2) candidates.push({ trackIndex, detectionIndex, iou });
      }
    }
    candidates.sort((a, b) =>
      b.iou - a.iou || a.trackIndex - b.trackIndex || a.detectionIndex - b.detectionIndex
    );
    const usedTracks = new Set<number>();
    const usedDetections = new Set<number>();
    const next = new Map<string, AnonymousTrack>();
    for (const candidate of candidates) {
      if (usedTracks.has(candidate.trackIndex) || usedDetections.has(candidate.detectionIndex)) continue;
      const track = previous[candidate.trackIndex];
      const detection = detections[candidate.detectionIndex];
      if (!track || !detection) continue;
      usedTracks.add(candidate.trackIndex);
      usedDetections.add(candidate.detectionIndex);
      next.set(track.episodeId, { ...detection, episodeId: track.episodeId, misses: 0 });
    }
    for (let index = 0; index < detections.length; index += 1) {
      const detection = detections[index];
      if (!detection || usedDetections.has(index)) continue;
      const episodeId = randomUUID();
      next.set(episodeId, { ...detection, episodeId, misses: 0 });
    }
    const lost: AnonymousTrack[] = [];
    for (let index = 0; index < previous.length; index += 1) {
      const track = previous[index];
      if (!track || usedTracks.has(index)) continue;
      const missed = { ...track, misses: track.misses + 1 };
      if (missed.misses > MAX_TRACK_MISSES) lost.push(missed);
      else next.set(missed.episodeId, missed);
    }
    this.tracks.clear();
    for (const [id, track] of next) this.tracks.set(id, track);
    return {
      active: [...next.values()].filter((track) => track.misses === 0),
      lost,
    };
  }

  private async publish(
    kind: 'camera_alive' | 'person_observed' | 'person_lost',
    observedAt: number,
    confidence: number,
    details: {
      presenceEpisodeId?: string;
      occupancyCount?: number;
      box2d?: Box2D;
    } = {}
  ): Promise<void> {
    if (!this.client) throw new Error('cognitive vision client is unavailable');
    this.sequence += 1;
    await this.client.publish({
      kind: 'percept',
      correlationId: correlationId(this.sequence),
      salience: kind === 'camera_alive' ? 0.1 : 0.75,
      confidence,
      privacy: 'local-only',
      ttlMs: 10_000,
      payload: {
        modality: 'vision',
        kind,
        observedAt,
        sensorId: SENSOR_ID,
        confidence,
        ...details,
      },
    });
  }

  private async ensureConnected(): Promise<void> {
    const client = await this.ensureClient();
    if (client.isReady) return;
    if (!this.connectPromise) {
      const attempt = client.connect();
      this.connectPromise = attempt;
      void attempt.finally(() => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      }).catch(() => undefined);
    }
    await this.connectPromise;
  }

  private async ensureClient(): Promise<CognitiveVisionConnection> {
    if (this.client) return this.client;
    const mod = await loadCoreModule<CognitiveBusClientModule>(
      'cognition/cognitive-bus-client.js'
    );
    if (!mod?.CognitiveBusClient) {
      throw new Error('core cognitive bus client is unavailable');
    }
    const client = new mod.CognitiveBusClient({
      wsUrl: cognitiveWsUrl(),
      ...(process.env.CODEBUDDY_COGNITIVE_HTTP_URL?.trim()
        ? { httpBaseUrl: process.env.CODEBUDDY_COGNITIVE_HTTP_URL.trim() }
        : {}),
      ...(process.env.CODEBUDDY_COGNITIVE_API_KEY?.trim()
        ? { apiKey: process.env.CODEBUDDY_COGNITIVE_API_KEY.trim() }
        : {}),
      ...(process.env.CODEBUDDY_COGNITIVE_JWT?.trim()
        ? { jwt: process.env.CODEBUDDY_COGNITIVE_JWT.trim() }
        : {}),
      requestTimeoutMs: 3_000,
      autoReconnect: true,
    });
    this.attachErrorListener(client);
    this.client = client;
    return client;
  }
}

let singleton: CoworkVisionCognition | null = null;

export function getCoworkVisionCognition(): CoworkVisionCognition {
  singleton ??= new CoworkVisionCognition();
  return singleton;
}

export async function resetCoworkVisionCognitionForTests(
  replacement?: CoworkVisionCognition
): Promise<void> {
  await singleton?.close().catch(() => undefined);
  singleton = replacement ?? null;
}
