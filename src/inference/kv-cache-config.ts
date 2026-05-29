/**
 * KV-Cache Configuration for Local LLM Inference
 *
 * Manages Key-Value cache settings for llama.cpp and LM Studio:
 * - Cache size estimation
 * - Quantization options (fp16, q8_0, q4_0)
 * - Context length management
 * - Memory offloading configuration
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type KVQuantization = 'f16' | 'f32' | 'q8_0' | 'q4_0' | 'q4_1';
export type OffloadMode = 'none' | 'partial' | 'full';

export interface ModelArchitecture {
  /** Number of layers */
  nLayers: number;
  /** Hidden dimension size */
  nEmbed: number;
  /** Number of attention heads */
  nHead: number;
  /** Number of key-value heads (for GQA) */
  nKVHead?: number;
  /** Head dimension (usually nEmbed / nHead) */
  headDim?: number;
}

export interface KVCacheConfig {
  /** Maximum context length */
  contextLength: number;
  /** KV cache quantization type */
  kvQuantization: KVQuantization;
  /** Memory offload mode */
  offloadMode: OffloadMode;
  /** Number of layers to offload to CPU */
  cpuOffloadLayers: number;
  /** Flash attention enabled */
  flashAttention: boolean;
  /** Batch size for continuous batching */
  batchSize: number;
  /** Ubatch size (micro-batch) */
  ubatchSize: number;
}

export interface KVCacheEstimate {
  /** Total KV cache size in bytes */
  totalBytes: number;
  /** Size per layer in bytes */
  perLayerBytes: number;
  /** GPU memory required (MB) */
  gpuMemoryMB: number;
  /** CPU memory required if offloading (MB) */
  cpuMemoryMB: number;
  /** Recommended configuration */
  recommendation: string;
  /** Whether it fits in available VRAM */
  fitsInVRAM: boolean;
}

export interface InferenceServerConfig {
  /** Base URL for the server */
  baseUrl: string;
  /** Server type */
  serverType: 'llamacpp' | 'lmstudio' | 'ollama' | 'vllm';
  /** KV cache configuration */
  kvCache: KVCacheConfig;
  /** Model architecture (for estimation) */
  architecture?: ModelArchitecture;
}

export const DEFAULT_KV_CACHE_CONFIG: KVCacheConfig = {
  contextLength: 4096,
  kvQuantization: 'f16',
  offloadMode: 'none',
  cpuOffloadLayers: 0,
  flashAttention: true,
  batchSize: 512,
  ubatchSize: 512,
};

// ============================================================================
// Common Model Architectures
// ============================================================================

export const MODEL_ARCHITECTURES: Record<string, ModelArchitecture> = {
  // Qwen 2.5
  'qwen2.5-0.5b': { nLayers: 24, nEmbed: 896, nHead: 14, nKVHead: 2 },
  'qwen2.5-1.5b': { nLayers: 28, nEmbed: 1536, nHead: 12, nKVHead: 2 },
  'qwen2.5-3b': { nLayers: 36, nEmbed: 2048, nHead: 16, nKVHead: 2 },
  'qwen2.5-7b': { nLayers: 28, nEmbed: 3584, nHead: 28, nKVHead: 4 },
  'qwen2.5-14b': { nLayers: 48, nEmbed: 5120, nHead: 40, nKVHead: 8 },
  'qwen2.5-32b': { nLayers: 64, nEmbed: 5120, nHead: 40, nKVHead: 8 },
  'qwen2.5-72b': { nLayers: 80, nEmbed: 8192, nHead: 64, nKVHead: 8 },

  // Llama 3.x
  'llama-3.2-1b': { nLayers: 16, nEmbed: 2048, nHead: 32, nKVHead: 8 },
  'llama-3.2-3b': { nLayers: 28, nEmbed: 3072, nHead: 24, nKVHead: 8 },
  'llama-3.1-8b': { nLayers: 32, nEmbed: 4096, nHead: 32, nKVHead: 8 },
  'llama-3.1-70b': { nLayers: 80, nEmbed: 8192, nHead: 64, nKVHead: 8 },

  // Mistral / Devstral
  'mistral-7b': { nLayers: 32, nEmbed: 4096, nHead: 32, nKVHead: 8 },
  'devstral-7b': { nLayers: 32, nEmbed: 4096, nHead: 32, nKVHead: 8 },
  'devstral-24b': { nLayers: 56, nEmbed: 5120, nHead: 32, nKVHead: 8 },

  // DeepSeek
  'deepseek-coder-6.7b': { nLayers: 32, nEmbed: 4096, nHead: 32, nKVHead: 32 },
  'deepseek-coder-33b': { nLayers: 62, nEmbed: 7168, nHead: 56, nKVHead: 56 },

  // StarCoder
  'starcoder2-3b': { nLayers: 30, nEmbed: 2560, nHead: 32, nKVHead: 4 },
  'starcoder2-7b': { nLayers: 32, nEmbed: 4608, nHead: 36, nKVHead: 4 },
  'starcoder2-15b': { nLayers: 40, nEmbed: 6144, nHead: 48, nKVHead: 4 },
};

// Bytes per element for different quantization types
const BYTES_PER_ELEMENT: Record<KVQuantization, number> = {
  f32: 4,
  f16: 2,
  q8_0: 1.0625, // 8 bits + 0.5 bits overhead
  q4_0: 0.5625, // 4 bits + 0.5 bits overhead
  q4_1: 0.625, // 4 bits + 1 bit overhead
};

// ============================================================================
// KV Cache Manager
// ============================================================================

export class KVCacheManager extends EventEmitter {
  private config: KVCacheConfig;
  private architecture: ModelArchitecture | null = null;

  constructor(config: Partial<KVCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_KV_CACHE_CONFIG, ...config };
  }

  /**
   * Set model architecture for accurate estimation
   */
  setArchitecture(arch: ModelArchitecture | string): void {
    if (typeof arch === 'string') {
      // Try to find architecture by model name
      const lowerName = arch.toLowerCase();
      for (const [key, value] of Object.entries(MODEL_ARCHITECTURES)) {
        if (lowerName.includes(key)) {
          this.architecture = value;
          logger.debug('Model architecture detected', { model: key, arch: value });
          return;
        }
      }
      logger.warn('Unknown model architecture, using defaults', { model: arch });
      // Use generic 7B architecture as fallback
      const fallbackArch = MODEL_ARCHITECTURES['llama-3.1-8b'];
      this.architecture = fallbackArch ?? null;
    } else {
      this.architecture = arch;
    }
  }

  /**
   * Estimate KV cache memory requirements
   */
  estimateMemory(
    contextLength?: number,
    batchSize?: number
  ): KVCacheEstimate {
    const ctx = contextLength ?? this.config.contextLength;
    const batch = batchSize ?? this.config.batchSize;

    if (!this.architecture) {
      // Use generic estimation without architecture
      return this.estimateGeneric(ctx, batch);
    }

    const arch = this.architecture;
    const nKVHead = arch.nKVHead ?? arch.nHead;
    const headDim = arch.headDim ?? Math.floor(arch.nEmbed / arch.nHead);

    // KV cache size per token per layer:
    // 2 (K and V) × nKVHead × headDim × bytesPerElement
    const bytesPerElement = BYTES_PER_ELEMENT[this.config.kvQuantization];
    const perTokenPerLayer = 2 * nKVHead * headDim * bytesPerElement;

    // Total per layer = perTokenPerLayer × contextLength × batchSize
    const perLayerBytes = perTokenPerLayer * ctx * batch;

    // Total = perLayerBytes × nLayers
    const totalBytes = perLayerBytes * arch.nLayers;

    // Calculate GPU vs CPU memory based on offload config
    const gpuLayers = arch.nLayers - this.config.cpuOffloadLayers;
    const cpuLayers = this.config.cpuOffloadLayers;

    const gpuMemoryMB = (perLayerBytes * gpuLayers) / (1024 * 1024);
    const cpuMemoryMB = (perLayerBytes * cpuLayers) / (1024 * 1024);

    // Simple VRAM check (assume we need at least 512MB headroom)
    const fitsInVRAM = gpuMemoryMB < 7500; // Conservative for 8GB GPU

    const recommendation = this.generateRecommendation(gpuMemoryMB, ctx);

    return {
      totalBytes,
      perLayerBytes,
      gpuMemoryMB,
      cpuMemoryMB,
      recommendation,
      fitsInVRAM,
    };
  }

  /**
   * Generic estimation without model architecture
   */
  private estimateGeneric(contextLength: number, batchSize: number): KVCacheEstimate {
    // Rough estimation: ~0.5-1 MB per 1K context for 7B model
    const bytesPerElement = BYTES_PER_ELEMENT[this.config.kvQuantization];
    const baseMemoryPerK = 0.75 * 1024 * 1024; // 0.75 MB per 1K tokens

    const totalBytes = (contextLength / 1000) * baseMemoryPerK * batchSize * bytesPerElement;
    const gpuMemoryMB = totalBytes / (1024 * 1024);

    return {
      totalBytes,
      perLayerBytes: totalBytes / 32, // Assume 32 layers
      gpuMemoryMB,
      cpuMemoryMB: 0,
      recommendation: this.generateRecommendation(gpuMemoryMB, contextLength),
      fitsInVRAM: gpuMemoryMB < 7500,
    };
  }

  /**
   * Generate configuration recommendation
   */
  private generateRecommendation(gpuMemoryMB: number, contextLength: number): string {
    if (gpuMemoryMB < 2000) {
      return 'Configuration looks good. KV cache fits comfortably in VRAM.';
    }
    if (gpuMemoryMB < 4000) {
      return 'Consider using q8_0 KV quantization to reduce memory usage.';
    }
    if (gpuMemoryMB < 6000) {
      return 'Recommend q4_0 KV quantization. Consider reducing context length.';
    }
    if (gpuMemoryMB < 8000) {
      return `KV cache is large. Recommend ctx=${Math.min(contextLength, 4096)}, kvQuant=q4_0, or enable CPU offload.`;
    }
    return 'KV cache exceeds typical VRAM. Enable partial offload or reduce context significantly.';
  }

  /**
   * Generate llama.cpp server arguments
   */
  generateLlamaCppArgs(): string[] {
    const args: string[] = [];

    // Context length
    args.push('-c', String(this.config.contextLength));

    // Batch sizes
    args.push('-b', String(this.config.batchSize));
    args.push('-ub', String(this.config.ubatchSize));

    // KV cache quantization
    if (this.config.kvQuantization !== 'f16') {
      args.push('--cache-type-k', this.config.kvQuantization);
      args.push('--cache-type-v', this.config.kvQuantization);
    }

    // Flash attention
    if (this.config.flashAttention) {
      args.push('-fa');
    }

    // GPU layers (if architecture known)
    if (this.architecture) {
      const gpuLayers = this.architecture.nLayers - this.config.cpuOffloadLayers;
      args.push('-ngl', String(gpuLayers));
    }

    return args;
  }

  /**
   * Generate LM Studio configuration
   */
  generateLMStudioConfig(): Record<string, unknown> {
    return {
      contextLength: this.config.contextLength,
      gpu: {
        offload: this.config.offloadMode !== 'none',
        layers: this.architecture
          ? this.architecture.nLayers - this.config.cpuOffloadLayers
          : 'auto',
      },
      kvCache: {
        quantization: this.config.kvQuantization,
      },
      inference: {
        batchSize: this.config.batchSize,
        flashAttention: this.config.flashAttention,
      },
    };
  }

  /**
   * Optimize configuration for available VRAM
   */
  optimizeForVRAM(availableVRAMMB: number, modelSizeMB: number): KVCacheConfig {
    // Reserve memory for model weights + some headroom
    const vramForKV = availableVRAMMB - modelSizeMB - 512; // 512MB headroom

    if (vramForKV < 500) {
      // Very limited VRAM - minimal config
      return {
        ...this.config,
        contextLength: 2048,
        kvQuantization: 'q4_0',
        batchSize: 256,
        ubatchSize: 256,
        offloadMode: 'partial',
        cpuOffloadLayers: this.architecture ? Math.floor(this.architecture.nLayers / 2) : 16,
      };
    }

    if (vramForKV < 2000) {
      // Limited VRAM - conservative config
      return {
        ...this.config,
        contextLength: 4096,
        kvQuantization: 'q4_0',
        batchSize: 512,
        ubatchSize: 512,
        offloadMode: 'none',
      };
    }

    if (vramForKV < 4000) {
      // Moderate VRAM
      return {
        ...this.config,
        contextLength: 8192,
        kvQuantization: 'q8_0',
        batchSize: 512,
        ubatchSize: 512,
        offloadMode: 'none',
      };
    }

    // Plenty of VRAM
    return {
      ...this.config,
      contextLength: 16384,
      kvQuantization: 'f16',
      batchSize: 1024,
      ubatchSize: 512,
      offloadMode: 'none',
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): KVCacheConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<KVCacheConfig>): void {
    Object.assign(this.config, config);
    this.emit('configUpdated', this.config);
  }

  /**
   * Format configuration for display
   */
  formatConfig(): string {
    const estimate = this.estimateMemory();
    const lines: string[] = [];

    lines.push('KV-Cache Configuration');
    lines.push('─────────────────────────────────────');
    lines.push(`Context Length:  ${this.config.contextLength.toLocaleString()}`);
    lines.push(`KV Quantization: ${this.config.kvQuantization}`);
    lines.push(`Flash Attention: ${this.config.flashAttention ? 'Enabled' : 'Disabled'}`);
    lines.push(`Batch Size:      ${this.config.batchSize}`);
    lines.push(`Offload Mode:    ${this.config.offloadMode}`);
    lines.push('');
    lines.push('Memory Estimate');
    lines.push('─────────────────────────────────────');
    lines.push(`GPU Memory:      ${estimate.gpuMemoryMB.toFixed(0)} MB`);
    if (estimate.cpuMemoryMB > 0) {
      lines.push(`CPU Memory:      ${estimate.cpuMemoryMB.toFixed(0)} MB`);
    }
    lines.push(`Fits in VRAM:    ${estimate.fitsInVRAM ? 'Yes' : 'No'}`);
    lines.push('');
    lines.push(`Recommendation: ${estimate.recommendation}`);

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let kvCacheManagerInstance: KVCacheManager | null = null;

export function getKVCacheManager(config?: Partial<KVCacheConfig>): KVCacheManager {
  if (!kvCacheManagerInstance) {
    kvCacheManagerInstance = new KVCacheManager(config);
  }
  return kvCacheManagerInstance;
}

export function resetKVCacheManager(): void {
  kvCacheManagerInstance = null;
}
