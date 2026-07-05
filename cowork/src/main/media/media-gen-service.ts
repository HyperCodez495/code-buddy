/**
 * Bridges the Cowork media surface to the CORE image_generate tool (loaded from
 * the embedded engine via loadCoreModule), so the GUI can generate images with
 * whatever backend the core is configured for (local ComfyUI / cloud). The core
 * module loader is injected so this is unit-testable without the engine.
 */
import { homedir } from 'os';
import { loadCoreModule } from '../utils/core-loader.js';

export interface MediaGenRequest {
  prompt: string;
  aspect?: string;
  /** Override CODEBUDDY_IMAGE_PROVIDER for this call (comfyui|openai|xai). */
  provider?: string;
  /** Override CODEBUDDY_IMAGE_MODEL for this call. */
  model?: string;
}

export interface MediaGenResponse {
  ok: boolean;
  outputPath?: string;
  url?: string;
  error?: string;
}

interface CoreMediaModule {
  generateImage(
    input: { prompt: string; aspectRatio?: string },
    runtime?: { env?: NodeJS.ProcessEnv; rootDir?: string },
  ): Promise<{ outputPath?: string; image: string | null }>;
}

type CoreLoader = () => Promise<CoreMediaModule | null>;

/** Map the GUI aspect (1:1 / 16:9 / 9:16) to the core's aspect ratio names. */
export function aspectToRatio(aspect?: string): 'landscape' | 'square' | 'portrait' {
  if (aspect === '16:9') return 'landscape';
  if (aspect === '9:16') return 'portrait';
  return 'square';
}

export class MediaGenService {
  private modPromise?: Promise<CoreMediaModule | null>;

  constructor(
    private readonly loader: CoreLoader = () => loadCoreModule<CoreMediaModule>('tools/media-generation-tool.js'),
    private readonly rootDir: string = homedir(),
  ) {}

  async generateImage(req: MediaGenRequest): Promise<MediaGenResponse> {
    const prompt = (req?.prompt ?? '').trim();
    if (!prompt) return { ok: false, error: 'prompt is required' };

    const mod = await (this.modPromise ??= this.loader());
    if (!mod?.generateImage) {
      return { ok: false, error: 'core media module unavailable (is the embedded engine configured?)' };
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (req.provider) env.CODEBUDDY_IMAGE_PROVIDER = req.provider;
    if (req.model) env.CODEBUDDY_IMAGE_MODEL = req.model;

    try {
      const res = await mod.generateImage(
        { prompt, aspectRatio: aspectToRatio(req.aspect) },
        { env, rootDir: this.rootDir },
      );
      const outputPath = res.outputPath ?? res.image ?? undefined;
      if (!outputPath) return { ok: false, error: 'image generation returned no local path' };
      return { ok: true, outputPath, url: `file://${outputPath}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
