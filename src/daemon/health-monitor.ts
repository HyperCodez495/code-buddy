/**
 * Health Monitor
 *
 * Monitors daemon health: CPU/memory usage, auto-recovery, health endpoints.
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface HealthMetrics {
  timestamp: Date;
  cpu: {
    usage: number; // percentage
    loadAvg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    heapTotal: number;
    rss: number;
    percentage: number;
  };
  uptime: number;
  services: { name: string; healthy: boolean }[];
}

export interface HealthMonitorConfig {
  /** Polling interval (ms) */
  intervalMs: number;
  /** Memory threshold for warning (percentage) */
  memoryWarningThreshold: number;
  /** Memory threshold for critical (percentage) */
  memoryCriticalThreshold: number;
  /** Max consecutive unhealthy checks before auto-recovery */
  maxUnhealthyChecks: number;
  /** Stale event threshold — if no events received within this window, emit 'stale' (ms) */
  staleEventThresholdMs?: number;
  /** Max total restarts before the monitor gives up */
  maxTotalRestarts?: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  intervalMs: 30000,
  memoryWarningThreshold: 80,
  memoryCriticalThreshold: 95,
  maxUnhealthyChecks: 3,
  staleEventThresholdMs: 120000, // 2 minutes
  maxTotalRestarts: 10,
};

// ============================================================================
// Health Monitor
// ============================================================================

export class HealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private startTime: number = 0;
  private unhealthyCount: number = 0;
  private lastMetrics: HealthMetrics | null = null;
  private serviceChecks: Map<string, () => boolean> = new Map();
  private lastEventTime: number = Date.now();
  private totalRestarts: number = 0;
  private staleTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a service health check
   */
  registerServiceCheck(name: string, check: () => boolean): void {
    this.serviceChecks.set(name, check);
  }

  /**
   * Record that an event was received (resets stale timer)
   */
  recordEvent(): void {
    this.lastEventTime = Date.now();
  }

  /**
   * Get total restart count
   */
  getTotalRestarts(): number {
    return this.totalRestarts;
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.running) return;
    this.startTime = Date.now();
    this.running = true;
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
    logger.debug('Health monitor started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    this.running = false;
    logger.debug('Health monitor stopped');
  }

  /**
   * Run a health check
   */
  check(): HealthMetrics {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const services = Array.from(this.serviceChecks.entries()).map(([name, check]) => ({
      name,
      healthy: check(),
    }));

    const metrics: HealthMetrics = {
      timestamp: new Date(),
      cpu: {
        usage: (os.loadavg()[0] ?? 0) * 100 / os.cpus().length,
        loadAvg: os.loadavg(),
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        percentage: (usedMem / totalMem) * 100,
      },
      uptime: Date.now() - this.startTime,
      services,
    };

    this.lastMetrics = metrics;

    // Check thresholds — increment unhealthyCount at most once per check cycle
    let isUnhealthy = false;
    if (metrics.memory.percentage >= this.config.memoryCriticalThreshold) {
      this.emit('critical', { type: 'memory', metrics });
      isUnhealthy = true;
    } else if (metrics.memory.percentage >= this.config.memoryWarningThreshold) {
      this.emit('warning', { type: 'memory', metrics });
      isUnhealthy = true;
    }

    // Check for unhealthy services
    const unhealthyServices = services.filter(s => !s.healthy);
    if (unhealthyServices.length > 0) {
      this.emit('service:unhealthy', { services: unhealthyServices });
      isUnhealthy = true;
    }

    if (isUnhealthy) {
      this.unhealthyCount++;
    } else {
      this.unhealthyCount = 0;
    }

    // Auto-recovery trigger
    if (this.unhealthyCount >= this.config.maxUnhealthyChecks) {
      this.totalRestarts++;
      const maxRestarts = this.config.maxTotalRestarts ?? 10;
      if (this.totalRestarts > maxRestarts) {
        this.emit('max-restarts-exceeded', { totalRestarts: this.totalRestarts, maxRestarts });
        this.stop();
      } else {
        this.emit('recovery-needed', { metrics, unhealthyCount: this.unhealthyCount });
      }
      this.unhealthyCount = 0;
    }

    // Stale event detection
    const staleThreshold = this.config.staleEventThresholdMs ?? 120000;
    if (Date.now() - this.lastEventTime > staleThreshold) {
      this.emit('stale', { lastEventTime: this.lastEventTime, elapsed: Date.now() - this.lastEventTime });
    }

    this.emit('check', metrics);
    return metrics;
  }

  /**
   * Get last collected metrics
   */
  getLastMetrics(): HealthMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Get health summary for API endpoint
   */
  getHealthSummary(): {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    memory: { percentage: number; rss: number };
    services: { name: string; healthy: boolean }[];
  } {
    const metrics = this.lastMetrics || this.check();

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (metrics.memory.percentage >= this.config.memoryCriticalThreshold) {
      status = 'critical';
    } else if (metrics.memory.percentage >= this.config.memoryWarningThreshold) {
      status = 'warning';
    }

    return {
      status,
      uptime: metrics.uptime,
      memory: {
        percentage: Math.round(metrics.memory.percentage * 100) / 100,
        rss: metrics.memory.rss,
      },
      services: metrics.services,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let monitorInstance: HealthMonitor | null = null;

export function getHealthMonitor(config?: Partial<HealthMonitorConfig>): HealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new HealthMonitor(config);
  }
  return monitorInstance;
}

export function resetHealthMonitor(): void {
  if (monitorInstance) {
    monitorInstance.stop();
  }
  monitorInstance = null;
}
