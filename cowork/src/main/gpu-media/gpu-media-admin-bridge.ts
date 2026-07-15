import { dialog } from 'electron';
import { writeFile } from 'fs/promises';
import type {
  GpuMediaAdminSubmitInput,
  GpuMediaCapabilities,
  GpuMediaDownloadResult,
  GpuMediaJobKind,
  GpuMediaJobView,
} from '../../shared/gpu-media-admin';
import { loadCoreModule } from '../utils/core-loader';

interface CoreGpuMediaClient {
  capabilities(): Promise<GpuMediaCapabilities>;
  submit(kind: GpuMediaJobKind, payload: unknown): Promise<GpuMediaJobView>;
  status(jobId: string): Promise<GpuMediaJobView>;
  cancel(jobId: string): Promise<GpuMediaJobView>;
  downloadArtifact(jobId: string, artifactName?: string): Promise<Uint8Array>;
}

interface CoreGpuMediaModule {
  gpuMediaWorkerFromEnv(env?: NodeJS.ProcessEnv): CoreGpuMediaClient;
}

interface SaveRequest {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  data: Uint8Array | string;
}

export interface GpuMediaAdminBridgeDeps {
  client?: () => Promise<CoreGpuMediaClient>;
  save?: (request: SaveRequest) => Promise<string | null>;
}

async function loadClient(): Promise<CoreGpuMediaClient> {
  const module = await loadCoreModule<CoreGpuMediaModule>('tools/gpu-media-worker.js');
  if (!module) throw new Error('Le module GPU de Code Buddy est indisponible. Recompile le cœur.');
  return module.gpuMediaWorkerFromEnv(process.env);
}

async function saveResult(request: SaveRequest): Promise<string | null> {
  const selected = await dialog.showSaveDialog({
    title: 'Enregistrer le résultat GPU',
    defaultPath: request.defaultPath,
    filters: request.filters,
  });
  if (selected.canceled || !selected.filePath) return null;
  await writeFile(selected.filePath, request.data);
  return selected.filePath;
}

export class GpuMediaAdminBridge {
  private readonly clientFactory: () => Promise<CoreGpuMediaClient>;
  private readonly save: (request: SaveRequest) => Promise<string | null>;
  private clientPromise: Promise<CoreGpuMediaClient> | null = null;

  constructor(deps: GpuMediaAdminBridgeDeps = {}) {
    this.clientFactory = deps.client ?? loadClient;
    this.save = deps.save ?? saveResult;
  }

  private client(): Promise<CoreGpuMediaClient> {
    this.clientPromise ??= this.clientFactory();
    return this.clientPromise;
  }

  async capabilities(): Promise<GpuMediaCapabilities> {
    return (await this.client()).capabilities();
  }

  async submit(input: GpuMediaAdminSubmitInput): Promise<GpuMediaJobView> {
    const client = await this.client();
    if (input.kind === 'panoworld_reconstruct') {
      return client.submit(input.kind, {
        sceneId: input.sceneId,
        profile: 'single-2048',
        panoramas: [{ imagePath: input.imagePath, roomId: input.roomId }],
        outputDir: input.outputDir,
      });
    }
    return client.submit(input.kind, {
      turnId: input.turnId,
      audioPath: input.audioPath,
      referenceImagePath: input.referenceImagePath,
      prompt: input.prompt,
      resolution: '480p',
    });
  }

  async status(jobId: string): Promise<GpuMediaJobView> {
    return (await this.client()).status(jobId);
  }

  async cancel(jobId: string): Promise<GpuMediaJobView> {
    return (await this.client()).cancel(jobId);
  }

  async download(jobId: string): Promise<GpuMediaDownloadResult> {
    try {
      const client = await this.client();
      const job = await client.status(jobId);
      if (job.status !== 'succeeded') {
        return { ok: false, error: 'Le résultat GPU n’est pas encore disponible.' };
      }
      if (job.kind === 'avatar_video_render') {
        const bytes = await client.downloadArtifact(job.id, 'avatar.mp4');
        const path = await this.save({
          defaultPath: `avatar-${job.id}.mp4`,
          filters: [{ name: 'Vidéo MP4', extensions: ['mp4'] }],
          data: bytes,
        });
        return path ? { ok: true, path, format: 'mp4' } : { ok: false, cancelled: true };
      }
      const path = await this.save({
        defaultPath: `panoworld-${job.id}.json`,
        filters: [{ name: 'Manifeste JSON', extensions: ['json'] }],
        data: `${JSON.stringify(job.output ?? {}, null, 2)}\n`,
      });
      return path ? { ok: true, path, format: 'json' } : { ok: false, cancelled: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
