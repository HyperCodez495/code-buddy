import type { DaemonStatus } from './daemon-manager.js';
import type { HeartbeatConfig, HeartbeatStatus } from './heartbeat.js';

export interface DaemonStatusReport {
  kind: 'codebuddy_daemon_status';
  schemaVersion: 1;
  generatedAt: string;
  status: {
    running: boolean;
    pid: number | null;
    uptimeMs: number | null;
    uptimeSeconds: number | null;
    startedAt: string | null;
    restartCount: number;
    services: Array<{
      name: string;
      running: boolean;
      startedAt: string | null;
      error: string | null;
    }>;
  };
  summary: {
    serviceCount: number;
    runningServiceCount: number;
    stoppedServiceCount: number;
  };
  recommendations: string[];
}

export interface HeartbeatStatusReport {
  kind: 'codebuddy_heartbeat_status';
  schemaVersion: 1;
  generatedAt: string;
  status: {
    running: boolean;
    enabled: boolean;
    lastRunTime: string | null;
    nextRunTime: string | null;
    consecutiveSuppressions: number;
    totalTicks: number;
    totalSuppressions: number;
    lastResultPreview: string | null;
    lastResultBytes: number;
  };
  config: {
    intervalMs: number;
    activeHoursStart: number;
    activeHoursEnd: number;
    timezone: string;
    heartbeatFilePath: string;
    suppressionKeyword: string;
    maxConsecutiveSuppressions: number;
  };
  recommendations: string[];
}

function formatDate(value: Date | undefined | null): string | null {
  if (!value) return null;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? value.toISOString() : null;
}

function previewHeartbeatResult(value: string | null): string | null {
  if (!value) return null;
  return value.length > 200 ? value.slice(0, 200) : value;
}

export function buildDaemonStatusReport(
  status: DaemonStatus,
  generatedAt: string = new Date().toISOString(),
): DaemonStatusReport {
  const services = status.services.map((service) => ({
    name: service.name,
    running: service.running,
    startedAt: formatDate(service.startedAt),
    error: service.error ?? null,
  }));
  const runningServiceCount = services.filter((service) => service.running).length;
  const stoppedServiceCount = services.length - runningServiceCount;
  const recommendations: string[] = [];

  if (!status.running) {
    recommendations.push('Start the daemon with `buddy daemon start --detach` before relying on scheduled jobs or background services.');
  } else if (services.length === 0) {
    recommendations.push('Daemon is running, but no service health details are currently reported.');
  } else if (stoppedServiceCount > 0) {
    recommendations.push('One or more daemon services are stopped; inspect daemon logs for service-level errors.');
  }

  return {
    kind: 'codebuddy_daemon_status',
    schemaVersion: 1,
    generatedAt,
    status: {
      running: status.running,
      pid: status.pid ?? null,
      uptimeMs: status.uptime ?? null,
      uptimeSeconds: typeof status.uptime === 'number' ? Math.round(status.uptime / 1000) : null,
      startedAt: formatDate(status.startedAt),
      restartCount: status.restartCount,
      services,
    },
    summary: {
      serviceCount: services.length,
      runningServiceCount,
      stoppedServiceCount,
    },
    recommendations,
  };
}

export function buildHeartbeatStatusReport(
  status: HeartbeatStatus,
  config: HeartbeatConfig,
  generatedAt: string = new Date().toISOString(),
): HeartbeatStatusReport {
  const recommendations: string[] = [];
  if (!status.enabled) {
    recommendations.push('Heartbeat engine is disabled. Run buddy heartbeat start to enable and schedule it.');
  } else if (!status.running) {
    recommendations.push('Heartbeat engine is enabled but not running. Run buddy heartbeat start.');
  }
  if (status.running && !status.nextRunTime) {
    recommendations.push('Heartbeat engine is running but no next run is scheduled.');
  }
  if (status.consecutiveSuppressions >= Math.max(1, config.maxConsecutiveSuppressions - 1)) {
    recommendations.push('Consecutive suppressions are near the configured limit.');
  }

  return {
    kind: 'codebuddy_heartbeat_status',
    schemaVersion: 1,
    generatedAt,
    status: {
      running: status.running,
      enabled: status.enabled,
      lastRunTime: formatDate(status.lastRunTime),
      nextRunTime: formatDate(status.nextRunTime),
      consecutiveSuppressions: status.consecutiveSuppressions,
      totalTicks: status.totalTicks,
      totalSuppressions: status.totalSuppressions,
      lastResultPreview: previewHeartbeatResult(status.lastResult),
      lastResultBytes: status.lastResult ? Buffer.byteLength(status.lastResult, 'utf8') : 0,
    },
    config: {
      intervalMs: config.intervalMs,
      activeHoursStart: config.activeHoursStart,
      activeHoursEnd: config.activeHoursEnd,
      timezone: config.timezone,
      heartbeatFilePath: config.heartbeatFilePath,
      suppressionKeyword: config.suppressionKeyword,
      maxConsecutiveSuppressions: config.maxConsecutiveSuppressions,
    },
    recommendations,
  };
}
