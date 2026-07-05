/**
 * Renderer bridge for media generation: wraps the preload `media.generateImage`
 * channel (which delegates to the core image_generate tool). Undefined outside
 * Electron so the UI can degrade gracefully.
 */
import type { MediaAspect } from './media-model.js';

export interface MediaGenApiRequest {
  prompt: string;
  aspect?: MediaAspect;
  /** comfyui | openai | xai — overrides CODEBUDDY_IMAGE_PROVIDER for this call. */
  provider?: string;
  model?: string;
}

export interface MediaGenApiResponse {
  ok: boolean;
  outputPath?: string;
  url?: string;
  error?: string;
}

export interface MediaGenApi {
  generateImage(request: MediaGenApiRequest): Promise<MediaGenApiResponse>;
}

interface MediaBridge {
  generateImage?: (request: MediaGenApiRequest) => Promise<MediaGenApiResponse>;
}

/** Resolve the media bridge from the preload API, or undefined in a browser. */
export function createMediaGenApi(): MediaGenApi | undefined {
  const bridge = (window as unknown as { electronAPI?: { media?: MediaBridge } }).electronAPI?.media;
  if (!bridge?.generateImage) return undefined;
  const generate = bridge.generateImage.bind(bridge);
  return { generateImage: (request) => generate(request) };
}
