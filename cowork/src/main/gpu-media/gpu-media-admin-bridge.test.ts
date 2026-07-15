import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() }, app: {} }));

import { GpuMediaAdminBridge } from './gpu-media-admin-bridge';
import type { GpuMediaJobView } from '../../shared/gpu-media-admin';

const panoJob: GpuMediaJobView = {
  id: 'gpu-pano',
  kind: 'panoworld_reconstruct',
  status: 'succeeded',
  output: { plyPath: 'D:\\results\\point_cloud.ply', checkpointSha256: 'abc' },
};

const avatarJob: GpuMediaJobView = {
  id: 'gpu-avatar',
  kind: 'avatar_video_render',
  status: 'succeeded',
  output: { artifactName: 'avatar.mp4' },
};

function harness(job = panoJob) {
  const client = {
    capabilities: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      workerId: 'darkstar',
      jobs: ['panoworld_reconstruct', 'avatar_video_render'],
    }),
    submit: vi.fn().mockResolvedValue(job),
    status: vi.fn().mockResolvedValue(job),
    cancel: vi.fn().mockResolvedValue({ ...job, status: 'cancelled' }),
    downloadArtifact: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  const save = vi.fn().mockResolvedValue('/tmp/result');
  const bridge = new GpuMediaAdminBridge({
    client: async () => client,
    save,
  });
  return { bridge, client, save };
}

describe('GpuMediaAdminBridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the bounded Cowork forms to the core worker contracts', async () => {
    const { bridge, client } = harness();
    await bridge.submit({
      kind: 'panoworld_reconstruct',
      sceneId: 'kitchen',
      roomId: 'room',
      imagePath: 'D:\\captures\\kitchen.jpg',
      outputDir: 'D:\\results',
    });
    expect(client.submit).toHaveBeenCalledWith('panoworld_reconstruct', {
      sceneId: 'kitchen',
      profile: 'single-2048',
      panoramas: [{ imagePath: 'D:\\captures\\kitchen.jpg', roomId: 'room' }],
      outputDir: 'D:\\results',
    });

    await bridge.submit({
      kind: 'avatar_video_render',
      turnId: 'turn-1',
      audioPath: 'D:\\audio.wav',
      referenceImagePath: 'D:\\lisa.png',
      prompt: 'Lisa parle face caméra.',
    });
    expect(client.submit).toHaveBeenLastCalledWith('avatar_video_render', {
      turnId: 'turn-1',
      audioPath: 'D:\\audio.wav',
      referenceImagePath: 'D:\\lisa.png',
      prompt: 'Lisa parle face caméra.',
      resolution: '480p',
    });
  });

  it('delegates status and cancellation to the authenticated core client', async () => {
    const { bridge, client } = harness();
    await expect(bridge.capabilities()).resolves.toMatchObject({ workerId: 'darkstar' });
    await expect(bridge.status('gpu-pano')).resolves.toEqual(panoJob);
    await expect(bridge.cancel('gpu-pano')).resolves.toMatchObject({ status: 'cancelled' });
    expect(client.status).toHaveBeenCalledWith('gpu-pano');
    expect(client.cancel).toHaveBeenCalledWith('gpu-pano');
  });

  it('exports a PanoWorld manifest and downloads the LongCat MP4', async () => {
    const pano = harness(panoJob);
    await expect(pano.bridge.download(panoJob.id)).resolves.toMatchObject({
      ok: true,
      format: 'json',
    });
    expect(pano.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'panoworld-gpu-pano.json',
        data: expect.stringContaining('point_cloud.ply'),
      })
    );

    const avatar = harness(avatarJob);
    await expect(avatar.bridge.download(avatarJob.id)).resolves.toMatchObject({
      ok: true,
      format: 'mp4',
    });
    expect(avatar.client.downloadArtifact).toHaveBeenCalledWith('gpu-avatar', 'avatar.mp4');
    expect(avatar.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'avatar-gpu-avatar.mp4' })
    );
  });

  it('does not export unfinished jobs or write after a cancelled save dialog', async () => {
    const pending = harness({ ...panoJob, status: 'running' });
    await expect(pending.bridge.download(panoJob.id)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('pas encore disponible'),
    });
    expect(pending.save).not.toHaveBeenCalled();

    const cancelled = harness(panoJob);
    cancelled.save.mockResolvedValueOnce(null);
    await expect(cancelled.bridge.download(panoJob.id)).resolves.toEqual({
      ok: false,
      cancelled: true,
    });
  });
});
