import { describe, expect, it, vi } from 'vitest';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn(async () => ({ wasm: true })),
  },
  FaceDetector: {
    createFromOptions: vi.fn(async () => ({
      detect: vi.fn(() => ({
        detections: [{
          boundingBox: { originX: 12, originY: 24, width: 80, height: 96 },
          keypoints: [{ x: 0.25, y: 0.35 }],
          categories: [{ score: 0.91 }],
        }],
      })),
    })),
  },
  HandLandmarker: {
    createFromOptions: vi.fn(async () => ({
      detect: vi.fn(() => ({
        landmarks: [
          Array.from({ length: 21 }, (_unused, index) => ({
            x: index / 100,
            y: index / 50,
            z: -index / 200,
          })),
        ],
        handednesses: [[{ categoryName: 'Right', score: 0.87 }]],
      })),
    })),
  },
  PoseLandmarker: {
    createFromOptions: vi.fn(async () => ({
      detect: vi.fn(() => ({
        landmarks: [
          Array.from({ length: 33 }, (_unused, index) => ({
            x: index / 33,
            y: index / 66,
            z: -index / 99,
          })),
        ],
      })),
    })),
  },
}));

describe('companion MediaPipe vision', () => {
  it('normalizes face, hand finger tips, and pose landmarks for companion percepts', async () => {
    const { analyzeCompanionMediaPipeFrame } = await import(
      '../src/renderer/services/companion/mediapipe-vision'
    );

    const analysis = await analyzeCompanionMediaPipeFrame({} as HTMLCanvasElement);

    expect(analysis).toMatchObject({
      engine: 'mediapipe_tasks_vision',
      runningMode: 'IMAGE',
      status: 'ok',
      faceCount: 1,
      handCount: 1,
      poseCount: 1,
      faces: [{
        boundingBox: { x: 12, y: 24, width: 80, height: 96 },
        confidence: 0.91,
        keypoints: [{ x: 0.25, y: 0.35 }],
      }],
      hands: [{
        handedness: 'Right',
        confidence: 0.87,
      }],
      poses: [{
        landmarkCount: 33,
      }],
    });
    expect(analysis.hands[0]?.fingerTips).toMatchObject({
      thumb: { x: 0.04, y: 0.08, z: -0.02 },
      index: { x: 0.08, y: 0.16, z: -0.04 },
      middle: { x: 0.12, y: 0.24, z: -0.06 },
      ring: { x: 0.16, y: 0.32, z: -0.08 },
      pinky: { x: 0.2, y: 0.4, z: -0.1 },
    });
  });
});
