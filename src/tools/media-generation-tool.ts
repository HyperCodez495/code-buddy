import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { getImageGenerationModel } from '../config/agent-defaults.js';
import { resolveToolGatewayRoute } from '../agent/tool-gateway-router.js';

export type ImageAspectRatio = 'landscape' | 'square' | 'portrait';
export type MediaProvider = 'openai' | 'xai' | 'fal' | 'comfyui';

export interface MediaGenerationRuntime {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}

export interface ImageGenerateInput {
  prompt: string;
  aspectRatio?: string;
}

export interface ImageGenerateResult {
  kind: 'image_generate_result';
  success: boolean;
  image: string | null;
  mediaPath?: string;
  outputPath?: string;
  provider: MediaProvider;
  model: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  generatedAt: string;
  revised_prompt?: string;
  error?: string;
  error_type?: string;
}

export interface VideoGenerateInput {
  prompt: string;
  imageUrl?: string;
  referenceImageUrls?: string[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  audio?: boolean;
  seed?: number;
  model?: string;
}

export interface VideoGenerateResult {
  kind: 'video_generate_result';
  success: boolean;
  video: string | null;
  mediaPath?: string;
  outputPath?: string;
  provider: MediaProvider;
  model: string;
  prompt: string;
  modality: 'text' | 'image';
  aspect_ratio: string;
  duration: number;
  generatedAt: string;
  request_id?: string;
  endpoint?: string;
  error?: string;
  error_type?: string;
}

interface ProviderConfig {
  provider: MediaProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface FalVideoFamily {
  textEndpoint: string;
  imageEndpoint: string;
  defaultDuration: number;
  supportsAudio: boolean;
  supportsNegativePrompt: boolean;
}

const IMAGE_SIZES: Record<ImageAspectRatio, string> = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
};

const FAL_VIDEO_FAMILIES: Record<string, FalVideoFamily> = {
  'pixverse-v6': {
    textEndpoint: 'fal-ai/pixverse/v6/text-to-video',
    imageEndpoint: 'fal-ai/pixverse/v6/image-to-video',
    defaultDuration: 5,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
  'ltx-2.3': {
    textEndpoint: 'fal-ai/ltx-2.3-22b/text-to-video',
    imageEndpoint: 'fal-ai/ltx-2.3-22b/image-to-video',
    defaultDuration: 5,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
  'veo3.1': {
    textEndpoint: 'fal-ai/veo3.1',
    imageEndpoint: 'fal-ai/veo3.1/image-to-video',
    defaultDuration: 4,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
};

export async function generateImage(
  input: ImageGenerateInput,
  runtime: MediaGenerationRuntime = {},
): Promise<ImageGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required for image generation');
  }

  const config = resolveImageProvider(runtime.env ?? process.env);
  const aspect = resolveImageAspect(input.aspectRatio);
  const fetchImpl = runtime.fetch ?? fetch;
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();

  // ComfyUI has a workflow-submit/poll/view API, not /images/generations.
  if (config.provider === 'comfyui') {
    return generateComfyUIImage(prompt, aspect, config, runtime, generatedAt);
  }

  const size = IMAGE_SIZES[aspect];
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    size,
    n: 1,
  };

  if (config.provider === 'openai') {
    body.quality = env(runtime.env, 'CODEBUDDY_IMAGE_QUALITY') ?? 'medium';
  } else if (config.provider === 'xai') {
    body.aspect_ratio = aspectToProviderRatio(aspect);
    body.resolution = env(runtime.env, 'CODEBUDDY_IMAGE_RESOLUTION') ?? '1k';
    delete body.size;
  }

  const response = await postJson(fetchImpl, joinUrl(config.baseUrl, '/images/generations'), {
    headers: authHeaders(config.apiKey),
    body,
  });
  const first = firstDataItem(response);
  const b64 = stringField(first, 'b64_json');
  const remoteUrl = stringField(first, 'url');
  const revisedPrompt = stringField(first, 'revised_prompt');

  let imageRef: string | undefined;
  let outputPath: string | undefined;
  if (b64) {
    const bytes = Buffer.from(b64, 'base64');
    outputPath = await saveGeneratedAsset(bytes, {
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image',
      extension: 'png',
      createId: runtime.createId,
    });
    imageRef = outputPath;
  } else if (remoteUrl) {
    const downloaded = await tryDownloadAsset(remoteUrl, {
      fetchImpl,
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image',
      fallbackExtension: 'png',
      createId: runtime.createId,
      maxBytes: 25 * 1024 * 1024,
    });
    outputPath = downloaded.outputPath;
    imageRef = downloaded.outputPath ?? remoteUrl;
  }

  if (!imageRef) {
    throw new Error('Image provider returned neither b64_json nor url');
  }

  await writeMediaSidecar(outputPath, {
    kind: 'image',
    prompt,
    ...(revisedPrompt ? { revisedPrompt } : {}),
    provider: config.provider,
    model: config.model,
    aspect_ratio: aspect,
    generatedAt,
  });

  return {
    kind: 'image_generate_result',
    success: true,
    image: imageRef,
    ...(outputPath ? { outputPath, mediaPath: `MEDIA:${outputPath}` } : {}),
    provider: config.provider,
    model: config.model,
    prompt,
    aspect_ratio: aspect,
    generatedAt,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// ComfyUI local image backend (offline, GPU). Distinct from the OpenAI-shaped
// providers: it submits a node graph to /prompt, polls /history/{id} until the
// SaveImage node reports outputs, then downloads the PNG from /view. Fail-closed
// on unreachable server / rejected workflow / timeout.
// ---------------------------------------------------------------------------

interface ComfyParams {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

const COMFY_DIMS: Record<ImageAspectRatio, { width: number; height: number }> = {
  landscape: { width: 1024, height: 768 },
  square: { width: 768, height: 768 },
  portrait: { width: 768, height: 1024 },
};

/** Sampler/step defaults keyed off the checkpoint family (turbo → few-step). */
function comfyParamsForModel(model: string): ComfyParams {
  const m = model.toLowerCase();
  if (m.includes('turbo') || m.includes('lightning') || m.includes('lcm') || m.includes('hyper')) {
    return { steps: 4, cfg: 1.0, sampler: 'euler', scheduler: 'sgm_uniform' };
  }
  if (m.includes('flux')) {
    return { steps: 20, cfg: 1.0, sampler: 'euler', scheduler: 'simple' };
  }
  return { steps: 20, cfg: 7.0, sampler: 'euler', scheduler: 'normal' };
}

function buildComfyWorkflow(
  prompt: string,
  negative: string,
  ckpt: string,
  dims: { width: number; height: number },
  params: ComfyParams,
  seed: number,
): Record<string, unknown> {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: params.sampler,
        scheduler: params.scheduler,
        denoise: 1.0,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: dims.width, height: dims.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'codebuddy', images: ['8', 0] } },
  };
}

interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/** First image emitted by any output node in a /history entry, or null. */
function firstComfyImage(outputs: unknown): ComfyImageRef | null {
  if (!outputs || typeof outputs !== 'object') return null;
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    const images = (node as { images?: unknown }).images;
    if (Array.isArray(images)) {
      for (const img of images) {
        const filename = stringField(img, 'filename');
        if (filename) {
          return {
            filename,
            subfolder: stringField(img, 'subfolder') ?? '',
            type: stringField(img, 'type') ?? 'output',
          };
        }
      }
    }
  }
  return null;
}

function comfyDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateComfyUIImage(
  prompt: string,
  aspect: ImageAspectRatio,
  config: ProviderConfig,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<ImageGenerateResult> {
  const fetchImpl = runtime.fetch ?? fetch;
  const envSource = runtime.env ?? process.env;
  const now = runtime.now ?? (() => new Date());
  const base = config.baseUrl;
  const negative = (env(envSource, 'CODEBUDDY_IMAGE_NEGATIVE') ?? 'blurry, low quality, deformed, watermark').trim();
  const params = comfyParamsForModel(config.model);
  const dims = COMFY_DIMS[aspect];
  const seed = Math.floor(now().getTime() % 2_000_000_000);
  const clientId = runtime.createId?.() ?? randomUUID();
  const workflow = buildComfyWorkflow(prompt, negative, config.model, dims, params, seed);

  const submit = await postJson(fetchImpl, joinUrl(base, '/prompt'), {
    headers: { 'Content-Type': 'application/json' },
    body: { prompt: workflow, client_id: clientId },
  });
  const promptId = stringField(submit, 'prompt_id');
  if (!promptId) {
    const errNode = submit.error ?? submit.node_errors;
    throw new Error(`ComfyUI rejected the workflow${errNode ? `: ${JSON.stringify(errNode).slice(0, 300)}` : ' (no prompt_id)'}`);
  }

  const timeoutMs = Number(env(envSource, 'CODEBUDDY_COMFYUI_TIMEOUT_MS') ?? '300000');
  const intervalMs = Number(env(envSource, 'CODEBUDDY_COMFYUI_POLL_MS') ?? '1500');
  const deadline = now().getTime() + (Number.isFinite(timeoutMs) ? timeoutMs : 300000);

  let image: ComfyImageRef | null = null;
  for (;;) {
    const history = await getJson(fetchImpl, joinUrl(base, `/history/${promptId}`), {
      Accept: 'application/json',
    });
    const entry = history[promptId] as { outputs?: unknown; status?: { status_str?: string } } | undefined;
    if (entry?.outputs) {
      image = firstComfyImage(entry.outputs);
      if (image) break;
      throw new Error(
        `ComfyUI finished without an image (status: ${entry.status?.status_str ?? 'unknown'})`,
      );
    }
    if (now().getTime() >= deadline) {
      throw new Error(`ComfyUI generation timed out after ${timeoutMs}ms (prompt ${promptId})`);
    }
    await comfyDelay(Number.isFinite(intervalMs) ? intervalMs : 1500);
  }

  const viewUrl = joinUrl(
    base,
    `/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`,
  );
  const viewResponse = await fetchImpl(viewUrl);
  if (!viewResponse.ok) {
    throw new Error(`ComfyUI /view returned ${viewResponse.status} for ${image.filename}`);
  }
  const bytes = Buffer.from(await viewResponse.arrayBuffer());
  const outputPath = await saveGeneratedAsset(bytes, {
    rootDir: runtime.rootDir,
    dirName: 'images',
    prefix: 'image',
    extension: 'png',
    createId: runtime.createId,
  });

  await writeMediaSidecar(outputPath, {
    kind: 'image',
    prompt,
    provider: 'comfyui',
    model: config.model,
    aspect_ratio: aspect,
    generatedAt,
  });

  return {
    kind: 'image_generate_result',
    success: true,
    image: outputPath,
    outputPath,
    mediaPath: `MEDIA:${outputPath}`,
    provider: 'comfyui',
    model: config.model,
    prompt,
    aspect_ratio: aspect,
    generatedAt,
  };
}

export async function generateVideo(
  input: VideoGenerateInput,
  runtime: MediaGenerationRuntime = {},
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required for video generation');
  }

  const config = resolveVideoProvider(input.model, runtime.env ?? process.env);
  const fetchImpl = runtime.fetch ?? fetch;
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();

  if (config.provider === 'fal') {
    return generateFalVideo(input, config, fetchImpl, runtime, generatedAt);
  }

  return generateXaiVideo(input, config, fetchImpl, runtime, generatedAt);
}

async function generateXaiVideo(
  input: VideoGenerateInput,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  const duration = clampInt(input.duration, 1, 15) ?? 8;
  const aspectRatio = input.aspectRatio?.trim() || '16:9';
  const resolution = input.resolution?.trim() || '720p';
  const imageUrl = input.imageUrl?.trim();
  const refs = (input.referenceImageUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
  };
  if (imageUrl) {
    body.image = { url: imageUrl };
  }
  if (refs.length > 0) {
    body.reference_images = refs.map((url) => ({ url }));
  }

  const submit = await postJson(fetchImpl, joinUrl(config.baseUrl, '/videos/generations'), {
    headers: {
      ...authHeaders(config.apiKey),
      'x-idempotency-key': randomUUID(),
    },
    body,
    timeoutMs: 60_000,
  });
  const requestId = stringField(submit, 'request_id') ?? stringField(submit, 'id');
  if (!requestId) {
    const direct = extractVideoUrl(submit);
    if (direct) {
      return materializeVideoResult(direct, {
        runtime,
        fetchImpl,
        provider: config.provider,
        model: config.model,
        prompt,
        modality: imageUrl ? 'image' : 'text',
        aspectRatio,
        duration,
        generatedAt,
      });
    }
    throw new Error('xAI video provider did not return request_id or video URL');
  }

  const pollUrl = joinUrl(config.baseUrl, `/videos/${encodeURIComponent(requestId)}`);
  const result = await pollVideoResult(fetchImpl, pollUrl, {
    headers: authHeaders(config.apiKey),
    timeoutMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_TIMEOUT_MS') ?? 240_000),
    intervalMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_POLL_INTERVAL_MS') ?? 1_000),
  });
  const videoUrl = extractVideoUrl(result);
  if (!videoUrl) {
    throw new Error('xAI video generation completed without a video URL');
  }
  return materializeVideoResult(videoUrl, {
    runtime,
    fetchImpl,
    provider: config.provider,
    model: stringField(result, 'model') ?? config.model,
    prompt,
    modality: imageUrl ? 'image' : 'text',
    aspectRatio,
    duration: numberField(objectField(result, 'video'), 'duration') ?? duration,
    generatedAt,
    requestId,
  });
}

async function generateFalVideo(
  input: VideoGenerateInput,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  const familyId = FAL_VIDEO_FAMILIES[config.model] ? config.model : 'pixverse-v6';
  const family = FAL_VIDEO_FAMILIES[familyId];
  if (!family) {
    throw new Error(`Unsupported FAL video model family: ${config.model}`);
  }

  const imageUrl = input.imageUrl?.trim();
  const endpoint = imageUrl ? family.imageEndpoint : family.textEndpoint;
  const duration = clampInt(input.duration, 1, 15) ?? family.defaultDuration;
  const payload: Record<string, unknown> = {
    prompt,
    duration: String(duration),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  if (imageUrl) {
    payload.image_url = imageUrl;
  }
  if (input.aspectRatio?.trim()) {
    payload.aspect_ratio = input.aspectRatio.trim();
  }
  if (input.resolution?.trim()) {
    payload.resolution = input.resolution.trim();
  }
  if (family.supportsAudio && input.audio !== undefined) {
    payload.generate_audio = input.audio;
  }
  if (family.supportsNegativePrompt && input.negativePrompt?.trim()) {
    payload.negative_prompt = input.negativePrompt.trim();
  }

  const submit = await postJson(fetchImpl, joinUrl(config.baseUrl, endpoint), {
    headers: {
      ...authHeaders(config.apiKey, 'Key'),
      'x-idempotency-key': randomUUID(),
    },
    body: payload,
    timeoutMs: 60_000,
  });

  const directVideo = extractVideoUrl(submit);
  const requestId = stringField(submit, 'request_id');
  if (directVideo) {
    return materializeVideoResult(directVideo, {
      runtime,
      fetchImpl,
      provider: 'fal',
      model: familyId,
      prompt,
      modality: imageUrl ? 'image' : 'text',
      aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
      duration,
      generatedAt,
      endpoint,
      requestId,
    });
  }

  const responseUrl = stringField(submit, 'response_url');
  const statusUrl = stringField(submit, 'status_url');
  const queued = statusUrl
    ? await pollVideoResult(fetchImpl, statusUrl, {
      headers: authHeaders(config.apiKey, 'Key'),
      timeoutMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_TIMEOUT_MS') ?? 300_000),
      intervalMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_POLL_INTERVAL_MS') ?? 1_000),
    })
    : {};
  const queuedVideo = extractVideoUrl(queued);
  const finalResponseUrl = stringField(queued, 'response_url') ?? responseUrl;
  if (queuedVideo) {
    return materializeVideoResult(queuedVideo, {
      runtime,
      fetchImpl,
      provider: 'fal',
      model: familyId,
      prompt,
      modality: imageUrl ? 'image' : 'text',
      aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
      duration,
      generatedAt,
      endpoint,
      requestId,
    });
  }
  if (!finalResponseUrl) {
    throw new Error('FAL video provider returned no video URL or response_url');
  }
  const finalResponse = await getJson(fetchImpl, finalResponseUrl, authHeaders(config.apiKey, 'Key'));
  const finalVideo = extractVideoUrl(finalResponse);
  if (!finalVideo) {
    throw new Error('FAL response_url did not contain a video URL');
  }
  return materializeVideoResult(finalVideo, {
    runtime,
    fetchImpl,
    provider: 'fal',
    model: familyId,
    prompt,
    modality: imageUrl ? 'image' : 'text',
    aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
    duration,
    generatedAt,
    endpoint,
    requestId,
  });
}

async function materializeVideoResult(
  videoUrl: string,
  options: {
    runtime: MediaGenerationRuntime;
    fetchImpl: typeof fetch;
    provider: MediaProvider;
    model: string;
    prompt: string;
    modality: 'text' | 'image';
    aspectRatio: string;
    duration: number;
    generatedAt: string;
    requestId?: string;
    endpoint?: string;
  },
): Promise<VideoGenerateResult> {
  const downloaded = await tryDownloadAsset(videoUrl, {
    fetchImpl: options.fetchImpl,
    rootDir: options.runtime.rootDir,
    dirName: 'videos',
    prefix: 'video',
    fallbackExtension: 'mp4',
    createId: options.runtime.createId,
    maxBytes: 250 * 1024 * 1024,
  });
  const outputPath = downloaded.outputPath;
  const videoRef = outputPath ?? videoUrl;
  await writeMediaSidecar(outputPath, {
    kind: 'video',
    prompt: options.prompt,
    provider: options.provider,
    model: options.model,
    modality: options.modality,
    aspect_ratio: options.aspectRatio,
    duration: options.duration,
  });
  return {
    kind: 'video_generate_result',
    success: true,
    video: videoRef,
    ...(outputPath ? { outputPath, mediaPath: `MEDIA:${outputPath}` } : {}),
    provider: options.provider,
    model: options.model,
    prompt: options.prompt,
    modality: options.modality,
    aspect_ratio: options.aspectRatio,
    duration: options.duration,
    generatedAt: options.generatedAt,
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  };
}

function resolveImageProvider(envSource: NodeJS.ProcessEnv): ProviderConfig {
  const requested = (envSource.CODEBUDDY_IMAGE_PROVIDER ?? '').trim().toLowerCase();
  // Local ComfyUI backend (offline, GPU) — no API key, workflow-based API.
  if (requested === 'comfyui') {
    const baseUrl = (envSource.COMFYUI_URL
      ?? envSource.CODEBUDDY_IMAGE_BASE_URL
      ?? 'http://127.0.0.1:8188').trim().replace(/\/+$/, '');
    const model = (envSource.CODEBUDDY_IMAGE_MODEL
      ?? envSource.COMFYUI_CHECKPOINT
      ?? 'sd_turbo.safetensors').trim();
    if (!baseUrl) {
      throw new Error('No ComfyUI base URL configured (set COMFYUI_URL)');
    }
    return { provider: 'comfyui', model, baseUrl, apiKey: '' };
  }
  const provider: MediaProvider = requested === 'xai' ? 'xai' : 'openai';
  const baseUrl = (envSource.CODEBUDDY_IMAGE_BASE_URL
    ?? (provider === 'xai' ? envSource.XAI_BASE_URL : envSource.OPENAI_BASE_URL)
    ?? (provider === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')).trim().replace(/\/+$/, '');
  const apiKey = (envSource.CODEBUDDY_IMAGE_API_KEY
    ?? (provider === 'xai' ? envSource.XAI_API_KEY : envSource.OPENAI_API_KEY)
    ?? '').trim();
  const model = (envSource.CODEBUDDY_IMAGE_MODEL
    ?? (provider === 'xai' ? envSource.XAI_IMAGE_MODEL : envSource.OPENAI_IMAGE_MODEL)
    ?? getImageGenerationModel()
    ?? (provider === 'xai' ? 'grok-imagine-image' : 'gpt-image-2')).trim();
  // Route through the Nous Tool Gateway when configured (transparent base-URL +
  // token substitution); otherwise use the direct provider.
  const route = resolveToolGatewayRoute('image_gen', envSource);
  const effectiveBaseUrl = route ? route.baseUrl : baseUrl;
  const effectiveApiKey = route?.token ?? apiKey;
  assertProviderReady(provider, effectiveApiKey, effectiveBaseUrl, 'image');
  return { provider, model, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey };
}

function resolveVideoProvider(modelOverride: string | undefined, envSource: NodeJS.ProcessEnv): ProviderConfig {
  const requested = (envSource.CODEBUDDY_VIDEO_PROVIDER ?? '').trim().toLowerCase();
  const provider: MediaProvider = requested === 'fal' ? 'fal' : 'xai';
  const baseUrl = (envSource.CODEBUDDY_VIDEO_BASE_URL
    ?? (provider === 'fal' ? envSource.FAL_BASE_URL : envSource.XAI_BASE_URL)
    ?? (provider === 'fal' ? 'https://queue.fal.run' : 'https://api.x.ai/v1')).trim().replace(/\/+$/, '');
  const apiKey = (envSource.CODEBUDDY_VIDEO_API_KEY
    ?? (provider === 'fal' ? envSource.FAL_KEY : envSource.XAI_API_KEY)
    ?? '').trim();
  const model = (modelOverride
    ?? envSource.CODEBUDDY_VIDEO_MODEL
    ?? (provider === 'fal' ? envSource.FAL_VIDEO_MODEL : envSource.XAI_VIDEO_MODEL)
    ?? (provider === 'fal' ? 'pixverse-v6' : 'grok-imagine-video')).trim();
  const route = resolveToolGatewayRoute('video_gen', envSource);
  const effectiveBaseUrl = route ? route.baseUrl : baseUrl;
  const effectiveApiKey = route?.token ?? apiKey;
  assertProviderReady(provider, effectiveApiKey, effectiveBaseUrl, 'video');
  return { provider, model, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey };
}

function assertProviderReady(provider: MediaProvider, apiKey: string, baseUrl: string, kind: string): void {
  if (!baseUrl) {
    throw new Error(`No ${kind} generation base URL configured for provider ${provider}`);
  }
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    throw new Error(`No ${kind} generation credentials configured for provider ${provider}`);
  }
}

function resolveImageAspect(value: string | undefined): ImageAspectRatio {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'square' || normalized === 'portrait' || normalized === 'landscape') {
    return normalized;
  }
  return 'landscape';
}

function aspectToProviderRatio(aspect: ImageAspectRatio): string {
  if (aspect === 'square') return '1:1';
  if (aspect === 'portrait') return '9:16';
  return '16:9';
}

function authHeaders(apiKey: string, scheme: 'Bearer' | 'Key' = 'Bearer'): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `${scheme} ${apiKey}` } : {}),
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  options: { headers: Record<string, string>; body: Record<string, unknown>; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(options.body),
  }, options.timeoutMs ?? 120_000);
  return readJsonResponse(response, url);
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, url, { headers }, 60_000);
  return readJsonResponse(response, url);
}

async function readJsonResponse(response: Response, url: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new Error(`${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${url} returned non-object JSON`);
}

async function pollVideoResult(
  fetchImpl: typeof fetch,
  url: string,
  options: { headers: Record<string, string>; timeoutMs: number; intervalMs: number },
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + options.timeoutMs;
  let lastStatus = 'queued';
  while (Date.now() < deadline) {
    const body = await getJson(fetchImpl, url, options.headers);
    lastStatus = (stringField(body, 'status') ?? stringField(body, 'state') ?? lastStatus).toLowerCase();
    if (['done', 'completed', 'succeeded', 'success', 'ready'].includes(lastStatus) || extractVideoUrl(body)) {
      return body;
    }
    if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(lastStatus)) {
      throw new Error(`Video generation failed with status ${lastStatus}: ${JSON.stringify(body).slice(0, 500)}`);
    }
    await sleep(Math.max(100, options.intervalMs));
  }
  throw new Error(`Timed out waiting for video generation after ${options.timeoutMs}ms (last status: ${lastStatus})`);
}

function firstDataItem(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    return data[0] as Record<string, unknown>;
  }
  return body;
}

function extractVideoUrl(body: Record<string, unknown>): string | undefined {
  const video = objectField(body, 'video');
  return (video ? stringField(video, 'url') : undefined)
    ?? stringField(body, 'video_url')
    ?? stringField(body, 'url')
    ?? stringField(body, 'output_url');
}

async function tryDownloadAsset(
  url: string,
  options: {
    fetchImpl: typeof fetch;
    rootDir?: string;
    dirName: string;
    prefix: string;
    fallbackExtension: string;
    createId?: () => string;
    maxBytes: number;
  },
): Promise<{ outputPath?: string }> {
  if (!/^https?:\/\//i.test(url)) {
    return {};
  }
  const response = await fetchWithTimeout(options.fetchImpl, url, {
    headers: { Accept: '*/*' },
  }, 120_000);
  if (!response.ok) {
    return {};
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > options.maxBytes) {
    return {};
  }
  const extension = inferExtension(response.headers.get('content-type'), url, options.fallbackExtension);
  const outputPath = await saveGeneratedAsset(bytes, {
    rootDir: options.rootDir,
    dirName: options.dirName,
    prefix: options.prefix,
    extension,
    createId: options.createId,
  });
  return { outputPath };
}

/**
 * Sidecar metadata next to a generated asset (`<file>.meta.json`) so the
 * media library can show the ORIGINAL prompt/provider/model (ChatGPT-library
 * parity) and regenerate variants from the real prompt. Fail-open: metadata
 * must never break a successful generation.
 */
export async function writeMediaSidecar(
  outputPath: string | undefined,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!outputPath) return;
  try {
    await fs.writeFile(`${outputPath}.meta.json`, JSON.stringify(meta, null, 1));
  } catch {
    /* sidecar is best-effort */
  }
}

async function saveGeneratedAsset(
  bytes: Buffer,
  options: {
    rootDir?: string;
    dirName: string;
    prefix: string;
    extension: string;
    createId?: () => string;
  },
): Promise<string> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const id = sanitizeId(options.createId?.() ?? `${Date.now()}-${randomUUID()}`);
  const outputDir = path.join(rootDir, '.codebuddy', 'media-generation', options.dirName);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${options.prefix}-${id}.${options.extension}`);
  await fs.writeFile(outputPath, bytes);
  return outputPath;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  if (/^https?:\/\//i.test(suffix)) {
    return suffix;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedSuffix = suffix.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSuffix}`;
}

function inferExtension(contentType: string | null, url: string, fallback: string): string {
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  const byType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/mpeg': 'mpeg',
  };
  if (type && byType[type]) {
    return byType[type];
  }
  const urlPath = url.split('?', 1)[0]?.toLowerCase() ?? '';
  const ext = path.extname(urlPath).replace('.', '');
  if (/^[a-z0-9]{2,5}$/.test(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return fallback;
}

function clampInt(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function env(runtimeEnv: NodeJS.ProcessEnv | undefined, key: string): string | undefined {
  const value = runtimeEnv?.[key] ?? process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = data[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || randomUUID();
}
