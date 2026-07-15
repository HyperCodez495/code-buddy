export type GpuMediaJobKind = 'panoworld_reconstruct' | 'avatar_video_render';
export type GpuMediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface GpuMediaCapabilities {
  protocolVersion: 1;
  workerId: string;
  jobs: GpuMediaJobKind[];
  gpus?: Array<{ name: string; vramMb: number; busy: boolean }>;
  queueDepth?: number;
}

export interface GpuMediaJobView {
  id: string;
  kind: GpuMediaJobKind;
  status: GpuMediaJobStatus;
  progress?: number;
  progressMessage?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface PanoWorldAdminInput {
  kind: 'panoworld_reconstruct';
  sceneId: string;
  imagePath: string;
  roomId: string;
  outputDir: string;
}

export interface AvatarVideoAdminInput {
  kind: 'avatar_video_render';
  turnId: string;
  audioPath: string;
  referenceImagePath: string;
  prompt: string;
}

export type GpuMediaAdminSubmitInput = PanoWorldAdminInput | AvatarVideoAdminInput;

export interface GpuMediaDownloadResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  error?: string;
  format?: 'mp4' | 'json';
}

export interface GpuMediaAdminApi {
  capabilities(): Promise<GpuMediaCapabilities>;
  submit(input: GpuMediaAdminSubmitInput): Promise<GpuMediaJobView>;
  status(jobId: string): Promise<GpuMediaJobView>;
  cancel(jobId: string): Promise<GpuMediaJobView>;
  download(jobId: string): Promise<GpuMediaDownloadResult>;
}
