import { describe, expect, it, vi } from 'vitest';

import { deliverAvatarJob } from '../../src/tools/gpu-avatar-delivery.js';

const payload = {
  turnId: 'telegram-1234',
  audioPath: '/data/lisa.wav',
  referenceImagePath: '/data/lisa.png',
  prompt: 'Lisa répond face caméra.',
  resolution: '480p' as const,
  channelTarget: {
    channel: 'telegram',
    conversationId: '12345',
    threadId: '42',
  },
};

describe('GPU avatar channel delivery', () => {
  it('polls to completion, downloads the MP4 and sends it to the same thread', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({ id: 'job-1', kind: 'avatar_video_render', status: 'running' })
      .mockResolvedValueOnce({ id: 'job-1', kind: 'avatar_video_render', status: 'succeeded' });
    const downloadArtifact = vi.fn().mockResolvedValue(new TextEncoder().encode('avatar-mp4'));
    const send = vi.fn().mockResolvedValue({ success: true, messageId: 'telegram-9' });

    await deliverAvatarJob(
      { status, downloadArtifact },
      'job-1',
      payload,
      { delay: async () => {}, now: () => 1_000, send }
    );

    expect(status).toHaveBeenCalledTimes(2);
    expect(downloadArtifact).toHaveBeenCalledWith('job-1');
    expect(send).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({
        channelId: '12345',
        threadId: '42',
        contentType: 'video',
        attachments: [
          expect.objectContaining({
            type: 'video',
            mimeType: 'video/mp4',
            data: Buffer.from('avatar-mp4').toString('base64'),
          }),
        ],
      })
    );
  });

  it('does not publish a failed render', async () => {
    const send = vi.fn();
    await expect(
      deliverAvatarJob(
        {
          status: vi.fn().mockResolvedValue({
            id: 'job-2',
            kind: 'avatar_video_render',
            status: 'failed',
            error: 'CUDA OOM',
          }),
          downloadArtifact: vi.fn(),
        },
        'job-2',
        payload,
        { send }
      )
    ).rejects.toThrow(/CUDA OOM/);
    expect(send).not.toHaveBeenCalled();
  });
});
