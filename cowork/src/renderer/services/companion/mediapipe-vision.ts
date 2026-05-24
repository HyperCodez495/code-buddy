/**
 * Companion MediaPipe vision — one-shot local perception for Buddy.
 *
 * Lisa's camera path does not stop at `getUserMedia`: it runs local
 * MediaPipe tasks over renderer frames, then turns the result into
 * structured percepts. This service mirrors that pattern for Cowork's
 * explicit companion cockpit actions.
 */

import type {
  Category,
  FaceDetector,
  HandLandmarker,
  Landmark,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';

type MediaPipeFrame = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const FINGER_TIPS = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
} as const;

export interface CompanionMediaPipePoint {
  x: number;
  y: number;
  z?: number;
}

export interface CompanionMediaPipeFace {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  keypoints: Array<{ x: number; y: number }>;
}

export interface CompanionMediaPipeHand {
  handedness?: 'Left' | 'Right' | string;
  confidence?: number;
  landmarks: CompanionMediaPipePoint[];
  fingerTips: Partial<Record<keyof typeof FINGER_TIPS, CompanionMediaPipePoint>>;
}

export interface CompanionMediaPipePose {
  landmarkCount: number;
  landmarks: CompanionMediaPipePoint[];
}

export interface CompanionMediaPipeVisionAnalysis {
  engine: 'mediapipe_tasks_vision';
  runningMode: 'IMAGE';
  status: 'ok' | 'unavailable' | 'error';
  models: string[];
  faceCount: number;
  handCount: number;
  poseCount: number;
  faces: CompanionMediaPipeFace[];
  hands: CompanionMediaPipeHand[];
  poses: CompanionMediaPipePose[];
  elapsedMs?: number;
  error?: string;
}

interface AnalyzerOptions {
  timeoutMs?: number;
}

class CompanionMediaPipeAnalyzer {
  private faceDetector: FaceDetector | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private poseLandmarker: PoseLandmarker | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const mp = await import('@mediapipe/tasks-vision');
    const vision = await mp.FilesetResolver.forVisionTasks(WASM_BASE_URL);

    const [faceDetector, handLandmarker, poseLandmarker] = await Promise.all([
      createWithDelegateFallback((delegate) => mp.FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
          delegate,
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })),
      createWithDelegateFallback((delegate) => mp.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate,
        },
        runningMode: 'IMAGE',
        numHands: 2,
      })),
      createWithDelegateFallback((delegate) => mp.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          delegate,
        },
        runningMode: 'IMAGE',
        numPoses: 1,
      })),
    ]);

    this.faceDetector = faceDetector;
    this.handLandmarker = handLandmarker;
    this.poseLandmarker = poseLandmarker;
    this.initialized = true;
  }

  analyze(frame: MediaPipeFrame): CompanionMediaPipeVisionAnalysis {
    if (!this.initialized) {
      throw new Error('Companion MediaPipe analyzer is not initialized.');
    }

    const faces = this.faceDetector
      ? normalizeFaces(this.faceDetector.detect(frame).detections)
      : [];
    const handResult = this.handLandmarker?.detect(frame);
    const hands = handResult
      ? normalizeHands(handResult.landmarks, readHandednesses(handResult))
      : [];
    const poseResult = this.poseLandmarker?.detect(frame);
    const poses = poseResult
      ? normalizePoses(poseResult.landmarks)
      : [];

    return {
      engine: 'mediapipe_tasks_vision',
      runningMode: 'IMAGE',
      status: 'ok',
      models: [
        'face_detector_blaze_face_short_range',
        'hand_landmarker',
        'pose_landmarker_lite',
      ],
      faceCount: faces.length,
      handCount: hands.length,
      poseCount: poses.length,
      faces,
      hands,
      poses,
    };
  }
}

let analyzerPromise: Promise<CompanionMediaPipeAnalyzer> | null = null;

export async function analyzeCompanionMediaPipeFrame(
  frame: MediaPipeFrame,
  options: AnalyzerOptions = {},
): Promise<CompanionMediaPipeVisionAnalysis> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 8000;

  try {
    const analyzer = await withTimeout(getAnalyzer(), timeoutMs, 'MediaPipe initialization timed out.');
    const analysis = await withTimeout(
      Promise.resolve().then(() => analyzer.analyze(frame)),
      timeoutMs,
      'MediaPipe frame analysis timed out.',
    );
    return {
      ...analysis,
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      engine: 'mediapipe_tasks_vision',
      runningMode: 'IMAGE',
      status: 'unavailable',
      models: [
        'face_detector_blaze_face_short_range',
        'hand_landmarker',
        'pose_landmarker_lite',
      ],
      faceCount: 0,
      handCount: 0,
      poseCount: 0,
      faces: [],
      hands: [],
      poses: [],
      elapsedMs: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getAnalyzer(): Promise<CompanionMediaPipeAnalyzer> {
  if (!analyzerPromise) {
    analyzerPromise = (async () => {
      const analyzer = new CompanionMediaPipeAnalyzer();
      await analyzer.initialize();
      return analyzer;
    })();
  }
  return analyzerPromise;
}

async function createWithDelegateFallback<T>(
  create: (delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<T | null> {
  try {
    return await create('GPU');
  } catch {
    try {
      return await create('CPU');
    } catch {
      return null;
    }
  }
}

function normalizeFaces(detections: Array<{
  boundingBox?: { originX?: number; originY?: number; width?: number; height?: number };
  keypoints?: Array<{ x?: number; y?: number }>;
  categories?: Category[];
}>): CompanionMediaPipeFace[] {
  return detections.map((detection) => ({
    boundingBox: {
      x: detection.boundingBox?.originX ?? 0,
      y: detection.boundingBox?.originY ?? 0,
      width: detection.boundingBox?.width ?? 0,
      height: detection.boundingBox?.height ?? 0,
    },
    confidence: detection.categories?.[0]?.score ?? 0,
    keypoints: (detection.keypoints ?? []).map((point) => ({
      x: point.x ?? 0,
      y: point.y ?? 0,
    })),
  }));
}

function normalizeHands(
  hands: NormalizedLandmark[][],
  handednesses: Array<Category[]>,
): CompanionMediaPipeHand[] {
  return hands.map((landmarks, index) => {
    const handedness = handednesses[index]?.[0];
    const normalized = landmarks.map(normalizePoint);
    return {
      ...(handedness?.categoryName ? { handedness: handedness.categoryName } : {}),
      ...(typeof handedness?.score === 'number' ? { confidence: handedness.score } : {}),
      landmarks: normalized,
      fingerTips: Object.fromEntries(
        Object.entries(FINGER_TIPS)
          .map(([name, landmarkIndex]) => [name, normalized[landmarkIndex]])
          .filter((entry): entry is [keyof typeof FINGER_TIPS, CompanionMediaPipePoint] => Boolean(entry[1])),
      ),
    };
  });
}

function normalizePoses(poses: NormalizedLandmark[][]): CompanionMediaPipePose[] {
  return poses.map((landmarks) => ({
    landmarkCount: landmarks.length,
    landmarks: landmarks.map(normalizePoint),
  }));
}

function normalizePoint(point: NormalizedLandmark | Landmark): CompanionMediaPipePoint {
  return {
    x: point.x,
    y: point.y,
    ...(typeof point.z === 'number' ? { z: point.z } : {}),
  };
}

function readHandednesses(result: object): Array<Category[]> {
  const maybe = result as {
    handednesses?: Array<Category[]>;
    handedness?: Array<Category[]>;
  };
  return maybe.handednesses ?? maybe.handedness ?? [];
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}
