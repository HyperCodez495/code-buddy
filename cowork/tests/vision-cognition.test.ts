import { describe, expect, it, vi } from 'vitest';
import {
  CoworkVisionCognition,
  extractSafeFaceDetections,
} from '../src/main/companion/vision-cognition';

function face(x: number, y: number, width: number, height: number, confidence = 0.9) {
  return {
    boundingBox: { x, y, width, height },
    confidence,
    keypoints: [{ x: 0.1, y: 0.2, z: 99 }],
    personId: 'Patrice',
  };
}

function snapshot(faces: unknown[]) {
  return {
    width: 640,
    height: 480,
    mediaPipe: {
      status: 'ok',
      faces,
      hands: [{ landmarks: [{ x: 1, y: 2, z: 3 }] }],
      poses: [],
      imagePath: '/private/frame.jpg',
    },
  };
}

function fakeClient() {
  let ready = false;
  const publish = vi.fn(async () => ({ replayed: false, revision: 1 }));
  return {
    get isReady() {
      return ready;
    },
    on: vi.fn(() => undefined),
    connect: vi.fn(async () => {
      ready = true;
    }),
    disconnect: vi.fn(async () => {
      ready = false;
    }),
    publish,
  };
}

describe('CoworkVisionCognition', () => {
  it('allowlists, clips and normalizes only safe face boxes', () => {
    const detections = extractSafeFaceDetections(snapshot([
      face(-10, 48, 210, 240, 0.8),
      face(700, 20, 30, 30),
      face(10, 20, -1, 20),
      face(10, 20, 30, 30, Number.NaN),
    ]));
    expect(detections).toEqual([{
      confidence: 0.8,
      box2d: {
        x: 0,
        y: 0.1,
        width: 0.3125,
        height: 0.5,
      },
    }]);
    expect(JSON.stringify(detections)).not.toContain('Patrice');
    expect(JSON.stringify(detections)).not.toContain('keypoints');
    expect(JSON.stringify(detections)).not.toContain('z');
    expect(extractSafeFaceDetections({
      width: 640,
      height: 480,
      mediaPipe: { status: 'unavailable', faces: [face(1, 1, 10, 10)] },
    })).toBeNull();
  });

  it('publishes anonymous multi-face state and never forwards renderer material', async () => {
    const client = fakeClient();
    const bridge = new CoworkVisionCognition(client as never);
    const result = await bridge.publishSnapshot(snapshot([
      face(50, 50, 100, 180, 0.91),
      face(350, 60, 100, 180, 0.88),
    ]));
    expect(result).toEqual({ cameraPublished: true, facesPublished: 2, lossesPublished: 0 });
    expect(client.publish).toHaveBeenCalledTimes(3);
    const drafts = client.publish.mock.calls.map(([draft]) => draft);
    expect(drafts.map((draft) => draft.kind)).toEqual(['percept', 'percept', 'percept']);
    expect(drafts.map((draft) => draft.payload.kind)).toEqual([
      'camera_alive',
      'person_observed',
      'person_observed',
    ]);
    expect(drafts.slice(1).every((draft) => draft.payload.occupancyCount === 2)).toBe(true);
    expect(drafts.slice(1).every((draft) =>
      typeof draft.payload.presenceEpisodeId === 'string'
    )).toBe(true);
    const serialized = JSON.stringify(drafts);
    expect(serialized).not.toContain('Patrice');
    expect(serialized).not.toContain('/private/frame.jpg');
    expect(serialized).not.toContain('landmarks');
    expect(serialized).not.toContain('keypoints');
    expect(serialized).not.toContain('"z"');
    await bridge.close();
  });

  it('keeps visible people authoritative and turns total detector loss into unknown', async () => {
    const client = fakeClient();
    const bridge = new CoworkVisionCognition(client as never);
    await bridge.publishSnapshot(snapshot([
      face(50, 50, 100, 180),
      face(350, 60, 100, 180),
    ]));
    client.publish.mockClear();

    const oneVisible = await bridge.publishSnapshot(snapshot([
      face(55, 52, 100, 180),
    ]));
    expect(oneVisible).toEqual({ cameraPublished: true, facesPublished: 1, lossesPublished: 0 });
    expect(client.publish.mock.calls.map(([draft]) => draft.payload.kind))
      .toEqual(['camera_alive', 'person_observed']);

    client.publish.mockClear();
    const firstEmpty = await bridge.publishSnapshot(snapshot([]));
    expect(firstEmpty.lossesPublished).toBe(1);
    expect(client.publish.mock.calls.map(([draft]) => draft.payload.kind))
      .toEqual(['camera_alive', 'person_lost']);

    client.publish.mockClear();
    const secondEmpty = await bridge.publishSnapshot(snapshot([]));
    expect(secondEmpty.lossesPublished).toBe(1);
    expect(client.publish.mock.calls.map(([draft]) => draft.payload.kind))
      .toEqual(['camera_alive', 'person_lost']);
    expect(JSON.stringify(client.publish.mock.calls)).not.toContain('departureConfirmed');
    await bridge.close();
  });

  it('fails soft when the shared cognitive service is absent', async () => {
    const client = fakeClient();
    client.connect.mockRejectedValueOnce(new Error('offline'));
    const bridge = new CoworkVisionCognition(client as never);
    await expect(bridge.publishSnapshot(snapshot([face(1, 1, 20, 20)]))).resolves.toEqual({
      cameraPublished: false,
      facesPublished: 0,
      lossesPublished: 0,
    });
    expect(client.publish).not.toHaveBeenCalled();
    await bridge.close();
  });

  it('serializes concurrent snapshots so tracker state and wire order cannot interleave', async () => {
    const client = fakeClient();
    let releaseFirst: (() => void) | undefined;
    client.publish.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ replayed: false, revision: 1 });
    }));
    const bridge = new CoworkVisionCognition(client as never);

    const first = bridge.publishSnapshot(snapshot([face(50, 50, 100, 180)]));
    const second = bridge.publishSnapshot(snapshot([face(55, 52, 100, 180)]));
    await vi.waitFor(() => expect(client.publish).toHaveBeenCalledTimes(1));
    expect(releaseFirst).toBeTypeOf('function');
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(client.publish.mock.calls.map(([draft]) => draft.payload.kind)).toEqual([
      'camera_alive',
      'person_observed',
      'camera_alive',
      'person_observed',
    ]);
    const episodes = client.publish.mock.calls
      .filter(([draft]) => draft.payload.kind === 'person_observed')
      .map(([draft]) => draft.payload.presenceEpisodeId);
    expect(new Set(episodes).size).toBe(1);
    await bridge.close();
  });
});
