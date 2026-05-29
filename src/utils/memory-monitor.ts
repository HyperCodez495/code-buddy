/**
 * Memory Monitor Utility
 *
 * Provides memory monitoring and leak detection for long-running CLI sessions.
 * Useful for tracking memory usage in agentic loops and context managers.
 */

import { EventEmitter } from 'events';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;      // MB
  heapTotal: number;     // MB
  external: number;      // MB
  rss: number;           // MB (Resident Set Size)
  arrayBuffers: number;  // MB
}

export interface MemoryMetrics {
  current: MemorySnapshot;
  peak: MemorySnapshot;
  baseline: MemorySnapshot | null;
  growth: number;            // MB since baseline
  growthRate: number;        // MB per minute
  snapshots: number;
  warningCount: number;
}

export interface MemoryMonitorConfig {
  /** Enable monitoring */
  enabled: boolean;
  /** Sampling interval in ms */
  intervalMs: number;
  /** Warning threshold in MB */
  warningThresholdMb: number;
  /** Critical threshold in MB */
  criticalThresholdMb: number;
  /** Number of snapshots to retain */
  maxSnapshots: number;
  /** Enable automatic GC hints */
  enableGCHints: boolean;
  /** Log warnings to console */
  logWarnings: boolean;
}

export interface MemoryWarning {
  type: 'warning' | 'critical';
  message: string;
  current: number;  // MB
  threshold: number; // MB
  timestamp: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MemoryMonitorConfig = {
  enabled: true,
  intervalMs: 30000,         // 30 seconds
  warningThresholdMb: 500,   // 500 MB
  criticalThresholdMb: 1000, // 1 GB
  maxSnapshots: 100,
  enableGCHints: true,
  logWarnings: true,
};

// ============================================================================
// Memory Monitor Class
// ============================================================================

export class MemoryMonitor extends EventEmitter {
  private config: MemoryMonitorConfig;
  private snapshots: MemorySnapshot[] = [];
  private peak: MemorySnapshot | null = null;
  private baseline: MemorySnapshot | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private warningCount: number = 0;
  private startTime: number = 0;

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring memory usage
   */
  start(): void {
    if (!this.config.enabled || this.intervalId) return;

    this.startTime = Date.now();
    this.baseline = this.takeSnapshot();
    this.peak = this.baseline;

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.config.intervalMs);

    this.emit('started', { baseline: this.baseline });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit('stopped', { metrics: this.getMetrics() });
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => bytes / (1024 * 1024);

    return {
      timestamp: Date.now(),
      heapUsed: toMB(mem.heapUsed),
      heapTotal: toMB(mem.heapTotal),
      external: toMB(mem.external),
      rss: toMB(mem.rss),
      arrayBuffers: toMB(mem.arrayBuffers),
    };
  }

  /**
   * Check memory and emit warnings if thresholds exceeded
   */
  checkMemory(): MemorySnapshot {
    const snapshot = this.takeSnapshot();

    // Store snapshot with bounded array
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    // Update peak
    if (!this.peak || snapshot.heapUsed > this.peak.heapUsed) {
      this.peak = snapshot;
      this.emit('peak', { peak: this.peak });
    }

    // Check thresholds
    if (snapshot.heapUsed >= this.config.criticalThresholdMb) {
      this.emitWarning('critical', snapshot);
    } else if (snapshot.heapUsed >= this.config.warningThresholdMb) {
      this.emitWarning('warning', snapshot);
    }

    // Suggest GC if growth is high
    if (this.config.enableGCHints && this.baseline) {
      const growth = snapshot.heapUsed - this.baseline.heapUsed;
      if (growth > 100) { // More than 100MB growth
        this.suggestGC();
      }
    }

    this.emit('snapshot', snapshot);
    return snapshot;
  }

  /**
   * Get current memory metrics
   */
  getMetrics(): MemoryMetrics {
    const current = this.takeSnapshot();
    const growth = this.baseline ? current.heapUsed - this.baseline.heapUsed : 0;

    // Calculate growth rate (MB per minute)
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const growthRate = elapsedMinutes > 0 ? growth / elapsedMinutes : 0;

    return {
      current,
      peak: this.peak || current,
      baseline: this.baseline,
      growth,
      growthRate,
      snapshots: this.snapshots.length,
      warningCount: this.warningCount,
    };
  }

  /**
   * Format metrics as human-readable string
   */
  formatMetrics(): string {
    const metrics = this.getMetrics();
    const lines = [
      'Memory Monitor Metrics:',
      `  Heap Used: ${metrics.current.heapUsed.toFixed(1)} MB`,
      `  Heap Total: ${metrics.current.heapTotal.toFixed(1)} MB`,
      `  RSS: ${metrics.current.rss.toFixed(1)} MB`,
      `  External: ${metrics.current.external.toFixed(1)} MB`,
      `  Peak Heap: ${metrics.peak.heapUsed.toFixed(1)} MB`,
      `  Growth: ${metrics.growth.toFixed(1)} MB (${metrics.growthRate.toFixed(2)} MB/min)`,
      `  Warnings: ${metrics.warningCount}`,
    ];
    return lines.join('\n');
  }

  /**
   * Get memory trend (positive = growing, negative = shrinking)
   */
  getTrend(): { trend: 'growing' | 'stable' | 'shrinking'; rate: number } {
    if (this.snapshots.length < 5) {
      return { trend: 'stable', rate: 0 };
    }

    // Compare recent average to older average
    const recentCount = Math.min(5, Math.floor(this.snapshots.length / 2));
    const recent = this.snapshots.slice(-recentCount);
    const older = this.snapshots.slice(-recentCount * 2, -recentCount);

    const recentAvg = recent.reduce((s, m) => s + m.heapUsed, 0) / recent.length;
    const olderAvg = older.reduce((s, m) => s + m.heapUsed, 0) / older.length;

    const rate = recentAvg - olderAvg;

    if (rate > 5) return { trend: 'growing', rate };
    if (rate < -5) return { trend: 'shrinking', rate };
    return { trend: 'stable', rate };
  }

  /**
   * Force garbage collection if available
   */
  forceGC(): boolean {
    if (typeof global.gc === 'function') {
      global.gc();
      this.emit('gc', { forced: true });
      return true;
    }
    return false;
  }

  /**
   * Reset baseline and clear history
   */
  reset(): void {
    this.snapshots = [];
    this.baseline = this.takeSnapshot();
    this.peak = this.baseline;
    this.warningCount = 0;
    this.startTime = Date.now();
    this.emit('reset', { baseline: this.baseline });
  }

  /**
   * Get snapshot history
   */
  getHistory(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Check for potential memory leaks
   */
  detectLeaks(): {
    potentialLeak: boolean;
    confidence: 'low' | 'medium' | 'high';
    evidence: string[];
  } {
    const evidence: string[] = [];
    let confidence: 'low' | 'medium' | 'high' = 'low';

    if (this.snapshots.length < 10) {
      return { potentialLeak: false, confidence: 'low', evidence: ['Insufficient data'] };
    }

    const trend = this.getTrend();
    const metrics = this.getMetrics();

    // Check for consistent growth
    if (trend.trend === 'growing' && trend.rate > 1) {
      evidence.push(`Memory growing at ${trend.rate.toFixed(2)} MB/min`);
      confidence = 'medium';
    }

    // Check for high absolute growth
    if (metrics.growth > 200) {
      evidence.push(`Total growth of ${metrics.growth.toFixed(1)} MB since baseline`);
      confidence = confidence === 'medium' ? 'high' : 'medium';
    }

    // Check warning count
    if (this.warningCount > 5) {
      evidence.push(`${this.warningCount} memory warnings triggered`);
      confidence = 'high';
    }

    // Check if heap never decreases
    let decreaseCount = 0;
    for (let i = 1; i < this.snapshots.length; i++) {
      const current = this.snapshots[i];
      const previous = this.snapshots[i - 1];
      if (current && previous && current.heapUsed < previous.heapUsed) {
        decreaseCount++;
      }
    }

    if (decreaseCount === 0 && this.snapshots.length > 20) {
      evidence.push('Heap size never decreased over monitoring period');
      confidence = 'high';
    }

    return {
      potentialLeak: evidence.length > 1,
      confidence,
      evidence,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryMonitorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryMonitorConfig {
    return { ...this.config };
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.stop();
    this.snapshots = [];
    this.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private emitWarning(type: 'warning' | 'critical', snapshot: MemorySnapshot): void {
    this.warningCount++;

    const threshold = type === 'critical'
      ? this.config.criticalThresholdMb
      : this.config.warningThresholdMb;

    const warning: MemoryWarning = {
      type,
      message: `Memory ${type}: ${snapshot.heapUsed.toFixed(1)} MB (threshold: ${threshold} MB)`,
      current: snapshot.heapUsed,
      threshold,
      timestamp: Date.now(),
    };

    if (this.config.logWarnings) {
      if (type === 'critical') {
        logger.error(warning.message);
      } else {
        logger.warn(warning.message);
      }
    }

    this.emit('warning', warning);
  }

  private suggestGC(): void {
    this.emit('gc:suggested', {
      message: 'High memory growth detected. Consider running GC.',
      growth: this.baseline ? this.takeSnapshot().heapUsed - this.baseline.heapUsed : 0,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let monitorInstance: MemoryMonitor | null = null;

export function getMemoryMonitor(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  if (!monitorInstance) {
    monitorInstance = new MemoryMonitor(config);
  }
  return monitorInstance;
}

export function startMemoryMonitoring(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  const monitor = getMemoryMonitor(config);
  monitor.start();
  return monitor;
}

export function stopMemoryMonitoring(): void {
  if (monitorInstance) {
    monitorInstance.stop();
  }
}

export function resetMemoryMonitor(): void {
  if (monitorInstance) {
    monitorInstance.dispose();
  }
  monitorInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick memory check without full monitoring
 */
export function getMemoryUsage(): MemorySnapshot {
  const monitor = getMemoryMonitor();
  return monitor.takeSnapshot();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Get memory pressure level
 */
export function getMemoryPressure(): 'low' | 'medium' | 'high' | 'critical' {
  const snapshot = getMemoryUsage();

  if (snapshot.heapUsed >= 1000) return 'critical';
  if (snapshot.heapUsed >= 500) return 'high';
  if (snapshot.heapUsed >= 200) return 'medium';
  return 'low';
}
