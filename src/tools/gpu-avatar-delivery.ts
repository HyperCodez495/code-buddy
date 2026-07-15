import type { ChannelType, DeliveryResult, OutboundMessage } from '../channels/core.js';
import { getChannelManager } from '../channels/core.js';
import { logger } from '../utils/logger.js';
import type {
  AvatarVideoPayload,
  GpuMediaJobView,
  GpuMediaWorkerClient,
} from './gpu-media-worker.js';

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;

interface AvatarWorkerClient {
  status(jobId: string): Promise<GpuMediaJobView>;
  downloadArtifact(jobId: string, artifactName?: string): Promise<Uint8Array>;
}

export interface AvatarDeliveryDependencies {
  send?: (
    channel: ChannelType,
    message: OutboundMessage
  ) => Promise<DeliveryResult>;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
}

const activeDeliveries = new Map<string, Promise<void>>();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function deliverAvatarJob(
  client: AvatarWorkerClient,
  jobId: string,
  payload: AvatarVideoPayload,
  dependencies: AvatarDeliveryDependencies = {}
): Promise<void> {
  const target = payload.channelTarget;
  if (!target) throw new Error('avatar delivery requires channelTarget');
  const delay = dependencies.delay ?? wait;
  const now = dependencies.now ?? Date.now;
  const pollMs = Math.max(100, dependencies.pollMs ?? DEFAULT_POLL_MS);
  const timeoutMs = Math.max(1_000, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const deadline = now() + timeoutMs;
  let job: GpuMediaJobView;
  for (;;) {
    job = await client.status(jobId);
    if (job.status === 'succeeded') break;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`avatar job ${jobId} ended as ${job.status}: ${job.error ?? 'no details'}`);
    }
    if (now() >= deadline) throw new Error(`avatar delivery timed out after ${timeoutMs} ms`);
    await delay(pollMs);
  }

  const artifact = await client.downloadArtifact(jobId);
  if (target.channel === 'telegram' && artifact.byteLength > TELEGRAM_UPLOAD_LIMIT) {
    throw new Error('avatar video exceeds the Telegram 50 MiB upload limit');
  }
  const send =
    dependencies.send ??
    ((channel: ChannelType, message: OutboundMessage) =>
      getChannelManager().send(channel, message));
  const result = await send(target.channel as ChannelType, {
    channelId: target.conversationId,
    content: `Vidéo de Lisa · ${payload.turnId}`,
    contentType: 'video',
    ...(target.threadId ? { threadId: target.threadId } : {}),
    parseMode: 'plain',
    attachments: [
      {
        type: 'video',
        data: Buffer.from(artifact).toString('base64'),
        mimeType: 'video/mp4',
        fileName: `lisa-${payload.turnId.replace(/[^A-Za-z0-9._-]/gu, '-')}.mp4`,
        size: artifact.byteLength,
      },
    ],
  });
  if (!result.success) {
    throw new Error(`avatar channel delivery failed: ${result.error ?? 'unknown error'}`);
  }
}

export function scheduleAvatarDelivery(
  client: GpuMediaWorkerClient,
  jobId: string,
  payload: AvatarVideoPayload
): void {
  if (!payload.channelTarget || activeDeliveries.has(jobId)) return;
  const delivery = deliverAvatarJob(client, jobId, payload)
    .catch((error) => {
      logger.warn(
        `[gpu-avatar] delivery ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    })
    .finally(() => activeDeliveries.delete(jobId));
  activeDeliveries.set(jobId, delivery);
}
