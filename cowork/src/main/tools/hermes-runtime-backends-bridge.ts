import { loadCoreModule } from '../utils/core-loader';

export type HermesRuntimeBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesRuntimeBackendReviewItem {
  command: string | null;
  configured: boolean;
  credentialSources: string[];
  id: string;
  installed: boolean;
  label: string;
  notes: string[];
  officialSurface: string;
  remediation: string[];
  runnable: boolean;
  smokeCommand: string | null;
  status: HermesRuntimeBackendStatus;
  version: string | null;
}

export interface HermesRuntimeBackendsReview {
  arch: string;
  availableCount: number;
  backends: HermesRuntimeBackendReviewItem[];
  command: string;
  configuredRemoteCount: number;
  generatedAt: string;
  issues: string[];
  ok: boolean;
  platform: string;
  recommendations: string[];
  runnableCount: number;
}

interface HermesRuntimeBackendsReadiness {
  arch: string;
  availableCount: number;
  backends: HermesRuntimeBackendReviewItem[];
  configuredRemoteCount: number;
  generatedAt: string;
  issues: string[];
  ok: boolean;
  platform: string;
  recommendations: string[];
  runnableCount: number;
}

interface HermesAgentDiagnostics {
  runtimeBackends: HermesRuntimeBackendsReadiness;
}

interface HermesAgentDiagnosticsModule {
  buildHermesAgentDiagnostics: () => HermesAgentDiagnostics;
}

export async function getHermesRuntimeBackendsForReview(): Promise<HermesRuntimeBackendsReview | null> {
  const mod = await loadCoreModule<HermesAgentDiagnosticsModule>('agent/hermes-agent-diagnostics.js');
  if (!mod?.buildHermesAgentDiagnostics) return null;

  const readiness = mod.buildHermesAgentDiagnostics().runtimeBackends;
  return {
    arch: readiness.arch,
    availableCount: readiness.availableCount,
    backends: readiness.backends.map((backend) => ({
      command: backend.command,
      configured: backend.configured,
      credentialSources: backend.credentialSources,
      id: backend.id,
      installed: backend.installed,
      label: backend.label,
      notes: backend.notes,
      officialSurface: backend.officialSurface,
      remediation: backend.remediation,
      runnable: backend.runnable,
      smokeCommand: backend.smokeCommand,
      status: backend.status,
      version: backend.version,
    })),
    command: 'buddy hermes doctor balanced --json',
    configuredRemoteCount: readiness.configuredRemoteCount,
    generatedAt: readiness.generatedAt,
    issues: readiness.issues,
    ok: readiness.ok,
    platform: readiness.platform,
    recommendations: readiness.recommendations,
    runnableCount: readiness.runnableCount,
  };
}
