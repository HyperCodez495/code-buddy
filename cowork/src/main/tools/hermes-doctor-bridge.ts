import { loadCoreModule } from '../utils/core-loader';

export interface HermesDoctorAreaReview {
  id: string;
  label: string;
  ok: boolean;
}

export interface HermesDoctorReview {
  agentName: string | null;
  areas: HermesDoctorAreaReview[];
  command: string;
  disabledToolCount: number;
  dispatchProfile: string;
  enabledToolCount: number;
  issues: string[];
  ok: boolean;
  recommendations: string[];
  source: 'built-in' | 'user' | 'missing';
}

interface HermesAgentDiagnostics {
  ok: boolean;
  agentName: string | null;
  dispatchProfile: string;
  source: 'built-in' | 'user' | 'missing';
  enabledTools: string[];
  disabledTools: string[];
  providerReadiness: { ok: boolean };
  runtimeBackends: { ok: boolean };
  browserBackends: { ok: boolean };
  promptChecks: { ok?: boolean };
  issues: string[];
  recommendations: string[];
}

interface HermesAgentDiagnosticsModule {
  buildHermesAgentDiagnostics: (options?: Record<string, unknown>) => HermesAgentDiagnostics;
}

/**
 * Read-only aggregate Hermes diagnostics ("doctor") for Cowork.
 * Mirrors `buddy hermes doctor --json` — rolls up the per-area readiness
 * into a single overview rather than duplicating the dedicated area strips.
 */
export async function getHermesDoctorForReview(): Promise<HermesDoctorReview | null> {
  const mod = await loadCoreModule<HermesAgentDiagnosticsModule>('agent/hermes-agent-diagnostics.js');
  if (!mod?.buildHermesAgentDiagnostics) return null;

  const diagnostics = mod.buildHermesAgentDiagnostics();
  const areas: HermesDoctorAreaReview[] = [
    { id: 'providers', label: 'Providers', ok: diagnostics.providerReadiness.ok },
    { id: 'runtime', label: 'Runtime backends', ok: diagnostics.runtimeBackends.ok },
    { id: 'browser', label: 'Browser backends', ok: diagnostics.browserBackends.ok },
    { id: 'prompt', label: 'Prompt checks', ok: diagnostics.promptChecks.ok !== false },
  ];

  return {
    agentName: diagnostics.agentName,
    areas,
    command: 'buddy hermes doctor --json',
    disabledToolCount: diagnostics.disabledTools.length,
    dispatchProfile: diagnostics.dispatchProfile,
    enabledToolCount: diagnostics.enabledTools.length,
    issues: diagnostics.issues,
    ok: diagnostics.ok,
    recommendations: diagnostics.recommendations,
    source: diagnostics.source,
  };
}
