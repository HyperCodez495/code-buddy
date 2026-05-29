/**
 * Inference Optimizer
 *
 * Calculates optimal inference configuration based on hardware profile.
 * Handles KV-cache sizing, model weight sizing, tensor parallelism,
 * and task routing (local-ollama / local-vllm / cloud).
 */

import { execSync } from 'child_process';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface HardwareProfile {
  cpu: {
    model: string;
    cores: number;
    ramGB: number;
    ramBandwidthGBs: number;
  };
  gpus: Array<{
    model: string;
    vramGB: number;
    backend: 'cuda' | 'rocm' | 'directml' | 'mps' | 'cpu';
  }>;
  turboQuantAvailable: boolean;
}

export interface InferenceConfig {
  model: string;
  quantization: '4bit' | '8bit' | 'fp16';
  kvCacheStrategy: 'fp16' | 'turboquant-4bit' | 'turboquant-2bit';
  maxContextTokens: number;
  estimatedVramGB: number;
  estimatedRamGB: number;
  tensorParallel: number;
  residualLength: number;
  skipLayers: number[];
  fits: boolean;
}

export interface ModelSpec {
  name: string;
  paramsBillions: number;
  numLayers: number;
  numKvHeads: number;
  headDim: number;
  defaultContext: number;
  maxContext: number;
}

export type RoutingDecision = 'local-ollama' | 'local-vllm' | 'cloud';

export interface RoutingTask {
  complexity: 'trivial' | 'simple' | 'complex';
  contextTokens: number;
}

// ============================================================================
// Known Model Specs
// ============================================================================

export const KNOWN_MODEL_SPECS: Record<string, ModelSpec> = {
  'devstral-24b': {
    name: 'Devstral-24B',
    paramsBillions: 24,
    numLayers: 56,
    numKvHeads: 8,
    headDim: 128,
    defaultContext: 32768,
    maxContext: 131072,
  },
  'llama-8b': {
    name: 'Llama-8B',
    paramsBillions: 8,
    numLayers: 32,
    numKvHeads: 8,
    headDim: 128,
    defaultContext: 8192,
    maxContext: 131072,
  },
  'qwen2.5-3b': {
    name: 'Qwen2.5-3B',
    paramsBillions: 3,
    numLayers: 36,
    numKvHeads: 2,
    headDim: 128,
    defaultContext: 32768,
    maxContext: 131072,
  },
};

// ============================================================================
// Calculation Helpers
// ============================================================================

/**
 * Calculate KV-cache memory in GB for a given model and sequence length.
 *
 * Formula base (FP16):
 *   2 (K+V) × numLayers × numKvHeads × headDim × seqLen × 2 bytes / 1e9
 *
 * TurboQuant-4bit divides by 7.1, TurboQuant-2bit divides by 14.2.
 */
export function calculateKvCacheGB(
  spec: ModelSpec,
  seqLen: number,
  strategy: 'fp16' | 'turboquant-4bit' | 'turboquant-2bit',
): number {
  const fp16Bytes = 2 * spec.numLayers * spec.numKvHeads * spec.headDim * seqLen * 2;
  const fp16GB = fp16Bytes / 1e9;

  switch (strategy) {
    case 'turboquant-4bit':
      return fp16GB / 7.1;
    case 'turboquant-2bit':
      return fp16GB / 14.2;
    default:
      return fp16GB;
  }
}

/**
 * Calculate model weight size in GB based on parameter count and quantization.
 *
 *   4bit  → params / 2  GB
 *   8bit  → params      GB
 *   fp16  → params * 2  GB
 */
export function calculateModelSizeGB(
  paramsBillions: number,
  quant: '4bit' | '8bit' | 'fp16',
): number {
  switch (quant) {
    case '4bit':
      return paramsBillions / 2;
    case '8bit':
      return paramsBillions;
    case 'fp16':
      return paramsBillions * 2;
  }
}

// ============================================================================
// Hardware Detection
// ============================================================================

/**
 * Run a shell command and return stdout, or null on failure.
 */
function runCommand(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

interface GpuDetected {
  model: string;
  vramGB: number;
  backend: 'cuda' | 'rocm' | 'directml' | 'mps' | 'cpu';
}

/**
 * Attempt to detect NVIDIA GPUs via nvidia-smi.
 */
function detectNvidiaGpus(): GpuDetected[] {
  const output = runCommand(
    'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
  );
  if (!output) return [];

  const gpus: GpuDetected[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split(',');
    const [rawModel, rawVram] = parts;
    if (rawModel === undefined || rawVram === undefined) continue;
    const model = rawModel.trim();
    const vramMB = parseInt(rawVram.trim(), 10);
    if (isNaN(vramMB)) continue;
    gpus.push({ model, vramGB: vramMB / 1024, backend: 'cuda' });
  }
  return gpus;
}

/**
 * Attempt to detect AMD GPUs via rocm-smi.
 */
function detectRocmGpus(): GpuDetected[] {
  const output = runCommand('rocm-smi --showmeminfo vram --csv');
  if (!output) return [];

  const gpus: GpuDetected[] = [];
  for (const line of output.split('\n')) {
    if (!line || line.startsWith('device')) continue;
    // rocm-smi csv: device,vram_total,vram_used
    const parts = line.split(',');
    const [rawDevice, rawVram] = parts;
    if (rawDevice === undefined || rawVram === undefined) continue;
    const vramBytes = parseInt(rawVram.trim(), 10);
    if (isNaN(vramBytes)) continue;
    gpus.push({ model: `AMD GPU ${rawDevice.trim()}`, vramGB: vramBytes / 1e9, backend: 'rocm' });
  }
  return gpus;
}

/**
 * Detect macOS MPS (Apple Silicon) GPU.
 */
function detectMpsGpu(): GpuDetected[] {
  if (process.platform !== 'darwin') return [];
  const output = runCommand('system_profiler SPDisplaysDataType -json');
  if (!output) return [];

  try {
    const data = JSON.parse(output) as {
      SPDisplaysDataType?: Array<{ sppci_model?: string; _spdisplays_vram?: string }>;
    };
    const displays = data.SPDisplaysDataType ?? [];
    return displays.map((d) => ({
      model: d.sppci_model ?? 'Apple Silicon GPU',
      vramGB: parseFloat(d._spdisplays_vram ?? '0') || 0,
      backend: 'mps' as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Estimate RAM bandwidth in GB/s from CPU model string.
 * Falls back to a conservative default when detection fails.
 */
function estimateRamBandwidth(cpuModel: string): number {
  const lower = cpuModel.toLowerCase();
  // Apple M-series (unified memory)
  if (lower.includes('apple m')) {
    if (lower.includes('m3') || lower.includes('m4')) return 300;
    if (lower.includes('m2')) return 200;
    return 100;
  }
  // High-end server CPUs
  if (lower.includes('epyc') || lower.includes('xeon')) return 400;
  // DDR5 desktop
  if (lower.includes('i9') || lower.includes('ryzen 9')) return 90;
  // DDR4 mainstream
  return 50;
}

/**
 * Detect hardware profile of the current machine.
 *
 * Detection order:
 *   1. nvidia-smi  (CUDA)
 *   2. rocm-smi    (ROCm)
 *   3. system_profiler (macOS MPS)
 *   4. CPU-only fallback
 *
 * turboQuantAvailable is true when a CUDA backend is present
 * (TurboQuant / GPTQ kernels require CUDA).
 */
export async function detectHardware(): Promise<HardwareProfile> {
  logger.debug('Detecting hardware profile');

  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU';
  const cores = os.cpus().length;
  const ramGB = os.totalmem() / 1e9;
  const ramBandwidthGBs = estimateRamBandwidth(cpuModel);

  const nvidiaGpus = detectNvidiaGpus();
  const rocmGpus = nvidiaGpus.length === 0 ? detectRocmGpus() : [];
  const mpsGpus = nvidiaGpus.length === 0 && rocmGpus.length === 0 ? detectMpsGpu() : [];

  const gpus: HardwareProfile['gpus'] = [
    ...nvidiaGpus,
    ...rocmGpus,
    ...mpsGpus,
  ];

  // CPU-only fallback
  if (gpus.length === 0) {
    gpus.push({ model: 'CPU', vramGB: 0, backend: 'cpu' });
  }

  const turboQuantAvailable = gpus.some((g) => g.backend === 'cuda');

  const profile: HardwareProfile = {
    cpu: { model: cpuModel, cores, ramGB, ramBandwidthGBs },
    gpus,
    turboQuantAvailable,
  };

  logger.debug('Hardware profile detected', {
    cpuModel,
    cores,
    ramGB: ramGB.toFixed(1),
    gpuCount: gpus.length,
    turboQuantAvailable,
  });

  return profile;
}

// ============================================================================
// Optimal Config Calculation
// ============================================================================

/**
 * Choose the best quantization given available total VRAM and model size.
 */
function chooseQuantization(
  totalVramGB: number,
  spec: ModelSpec,
): '4bit' | '8bit' | 'fp16' {
  if (calculateModelSizeGB(spec.paramsBillions, 'fp16') <= totalVramGB * 0.6) {
    return 'fp16';
  }
  if (calculateModelSizeGB(spec.paramsBillions, '8bit') <= totalVramGB * 0.6) {
    return '8bit';
  }
  return '4bit';
}

/**
 * Choose the best KV-cache strategy given available VRAM budget.
 */
function chooseKvStrategy(
  vramBudgetGB: number,
  spec: ModelSpec,
  seqLen: number,
  turboQuantAvailable: boolean,
): 'fp16' | 'turboquant-4bit' | 'turboquant-2bit' {
  if (vramBudgetGB > 0 && calculateKvCacheGB(spec, seqLen, 'fp16') <= vramBudgetGB) {
    return 'fp16';
  }
  if (turboQuantAvailable && vramBudgetGB > 0 && calculateKvCacheGB(spec, seqLen, 'turboquant-4bit') <= vramBudgetGB) {
    return 'turboquant-4bit';
  }
  if (turboQuantAvailable && vramBudgetGB > 0 && calculateKvCacheGB(spec, seqLen, 'turboquant-2bit') <= vramBudgetGB) {
    return 'turboquant-2bit';
  }
  // No strategy fits within budget — prefer turboquant when available (smallest footprint)
  if (turboQuantAvailable) {
    return 'turboquant-2bit';
  }
  return 'fp16';
}

/**
 * Determine which layers can be skipped when VRAM is very tight.
 * Returns indices of non-critical middle layers (roughly every 4th layer).
 */
function computeSkipLayers(numLayers: number, vramTight: boolean): number[] {
  if (!vramTight) return [];
  const skip: number[] = [];
  // Skip every 4th layer in the middle 50% of the network
  const start = Math.floor(numLayers * 0.25);
  const end = Math.floor(numLayers * 0.75);
  for (let i = start; i < end; i += 4) {
    skip.push(i);
  }
  return skip;
}

/**
 * Calculate optimal inference configuration for a model on given hardware.
 *
 * @param spec - Model specification
 * @param hardware - Detected hardware profile
 * @param targetContext - Desired context window (defaults to spec.defaultContext)
 */
export function getOptimalConfig(
  spec: ModelSpec,
  hardware: HardwareProfile,
  targetContext?: number,
): InferenceConfig {
  const seqLen = targetContext ?? spec.defaultContext;
  const clampedSeqLen = Math.min(seqLen, spec.maxContext);

  // Aggregate VRAM across GPUs
  const totalVramGB = hardware.gpus.reduce((sum, g) => sum + g.vramGB, 0);
  const tensorParallel = Math.max(1, hardware.gpus.filter((g) => g.backend !== 'cpu').length);

  const quantization = chooseQuantization(totalVramGB, spec);
  const modelSizeGB = calculateModelSizeGB(spec.paramsBillions, quantization);

  // Budget remaining VRAM for KV cache (leave 10% headroom)
  const vramHeadroom = totalVramGB * 0.1;
  const kvVramBudget = Math.max(0, totalVramGB - modelSizeGB - vramHeadroom);

  const kvCacheStrategy = chooseKvStrategy(
    kvVramBudget,
    spec,
    clampedSeqLen,
    hardware.turboQuantAvailable,
  );
  const kvCacheGB = calculateKvCacheGB(spec, clampedSeqLen, kvCacheStrategy);

  const estimatedVramGB = modelSizeGB + kvCacheGB;
  // RAM usage: model weights spill to RAM when VRAM insufficient + OS overhead
  const estimatedRamGB = Math.max(0, estimatedVramGB - totalVramGB) + 2;

  const fits = estimatedVramGB <= totalVramGB;
  const vramTight = !fits || (kvVramBudget < kvCacheGB * 1.2);

  // Residual length: how many tokens we can reliably fit in context
  const residualLength = fits
    ? clampedSeqLen
    : Math.floor(clampedSeqLen * (kvVramBudget / Math.max(kvCacheGB, 0.001)));

  const skipLayers = computeSkipLayers(spec.numLayers, vramTight && !fits);

  logger.debug('Computed optimal inference config', {
    model: spec.name,
    quantization,
    kvCacheStrategy,
    fits,
    estimatedVramGB: estimatedVramGB.toFixed(2),
    tensorParallel,
  });

  return {
    model: spec.name,
    quantization,
    kvCacheStrategy,
    maxContextTokens: clampedSeqLen,
    estimatedVramGB,
    estimatedRamGB,
    tensorParallel,
    residualLength,
    skipLayers,
    fits,
  };
}

// ============================================================================
// Task Routing
// ============================================================================

/**
 * Route a task to the most appropriate inference backend.
 *
 * Routing logic:
 *   - trivial + small context → local-ollama (lightweight, always-on)
 *   - simple/trivial + fits in local VRAM → local-vllm (fast throughput)
 *   - complex or context too large for local → cloud
 */
export function routeTask(task: RoutingTask, hardware: HardwareProfile): RoutingDecision {
  const totalVramGB = hardware.gpus.reduce((sum, g) => sum + g.vramGB, 0);
  const hasCudaGpu = hardware.gpus.some((g) => g.backend === 'cuda' || g.backend === 'rocm');

  // Complex tasks always go to cloud for best quality
  if (task.complexity === 'complex') {
    logger.debug('Routing complex task to cloud');
    return 'cloud';
  }

  // Large context beyond typical local capacity → cloud
  if (task.contextTokens > 32768 && totalVramGB < 20) {
    logger.debug('Routing large-context task to cloud', { contextTokens: task.contextTokens });
    return 'cloud';
  }

  // Trivial tasks → ollama (low overhead, always responsive)
  if (task.complexity === 'trivial' && task.contextTokens <= 4096) {
    logger.debug('Routing trivial task to local-ollama');
    return 'local-ollama';
  }

  // Use vllm when a capable GPU is present with enough VRAM and context is manageable
  if (hasCudaGpu && totalVramGB >= 8 && task.contextTokens <= 32768) {
    logger.debug('Routing task to local-vllm', { vramGB: totalVramGB });
    return 'local-vllm';
  }

  // CUDA present but VRAM is too low for reliable inference → cloud
  if (hasCudaGpu && totalVramGB < 8) {
    logger.debug('Routing to cloud: CUDA GPU has insufficient VRAM', { vramGB: totalVramGB });
    return 'cloud';
  }

  // CPU-only machines: ollama for simple, cloud for the rest
  if (task.complexity === 'simple') {
    return 'local-ollama';
  }

  return 'cloud';
}

// ============================================================================
// Singleton
// ============================================================================

export class InferenceOptimizer {
  private cachedHardware: HardwareProfile | null = null;

  /**
   * Return cached hardware profile (detecting once on first call).
   */
  async getHardware(): Promise<HardwareProfile> {
    if (!this.cachedHardware) {
      this.cachedHardware = await detectHardware();
    }
    return this.cachedHardware;
  }

  /**
   * Invalidate the cached hardware profile (useful after hardware changes).
   */
  resetCache(): void {
    this.cachedHardware = null;
  }

  /**
   * Get optimal config for a named model spec.
   */
  async getOptimalConfigForModel(
    modelKey: string,
    targetContext?: number,
  ): Promise<InferenceConfig | null> {
    const spec = KNOWN_MODEL_SPECS[modelKey.toLowerCase()];
    if (!spec) {
      logger.warn('Unknown model spec key', { modelKey });
      return null;
    }
    const hardware = await this.getHardware();
    return getOptimalConfig(spec, hardware, targetContext);
  }

  /**
   * Route a task using the current hardware profile.
   */
  async routeTask(task: RoutingTask): Promise<RoutingDecision> {
    const hardware = await this.getHardware();
    return routeTask(task, hardware);
  }
}

let inferenceOptimizerInstance: InferenceOptimizer | null = null;

export function getInferenceOptimizer(): InferenceOptimizer {
  if (!inferenceOptimizerInstance) {
    inferenceOptimizerInstance = new InferenceOptimizer();
  }
  return inferenceOptimizerInstance;
}

export function resetInferenceOptimizer(): void {
  inferenceOptimizerInstance = null;
}
