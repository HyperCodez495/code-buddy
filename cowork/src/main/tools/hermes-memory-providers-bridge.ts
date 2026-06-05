import { loadCoreModule } from '../utils/core-loader';

export type HermesMemoryProviderStatus = 'available' | 'configured' | 'fallback' | 'missing';

export interface HermesMemoryProviderReviewItem {
  active: boolean;
  baseUrlSources: string[];
  configured: boolean;
  credentialSources: string[];
  id: string;
  label: string;
  local: boolean;
  notes: string[];
  officialSurface: string;
  registered: boolean;
  remediation: string[];
  status: HermesMemoryProviderStatus;
}

export interface HermesMemoryProvidersReview {
  activeProviderId: string;
  command: string;
  configuredRemoteCount: number;
  fallbackCount: number;
  generatedAt: string;
  issues: string[];
  missingOfficialCount: number;
  ok: boolean;
  providers: HermesMemoryProviderReviewItem[];
  recommendations: string[];
  registeredCount: number;
}

interface HermesMemoryProvidersReadiness {
  activeProviderId: string;
  configuredRemoteCount: number;
  fallbackCount: number;
  generatedAt: string;
  issues: string[];
  missingOfficialCount: number;
  ok: boolean;
  providers: HermesMemoryProviderReviewItem[];
  recommendations: string[];
  registeredCount: number;
}

export interface HermesMemoryProbeResult {
  activeProviderId: string;
  error?: string;
  fellBackToLocal: boolean;
  generatedAt: string;
  notes: string[];
  ok: boolean;
  providerId: string;
  remote: boolean;
  retrieved: boolean;
  retrievedSample?: string;
  verdict: 'pass' | 'pending' | 'fail';
  wrote: boolean;
}

interface HermesMemoryProvidersModule {
  buildHermesMemoryProvidersReadiness: () => HermesMemoryProvidersReadiness;
}

interface HermesMemoryProbeModule {
  probeMemoryProvider: (providerId?: string) => Promise<HermesMemoryProbeResult>;
}

export async function getHermesMemoryProvidersForReview(): Promise<HermesMemoryProvidersReview | null> {
  const mod = await loadCoreModule<HermesMemoryProvidersModule>('agent/hermes-memory-providers.js');
  if (!mod?.buildHermesMemoryProvidersReadiness) return null;

  const readiness = mod.buildHermesMemoryProvidersReadiness();
  return {
    activeProviderId: readiness.activeProviderId,
    command: 'buddy hermes memory status --json',
    configuredRemoteCount: readiness.configuredRemoteCount,
    fallbackCount: readiness.fallbackCount,
    generatedAt: readiness.generatedAt,
    issues: readiness.issues,
    missingOfficialCount: readiness.missingOfficialCount,
    ok: readiness.ok,
    providers: readiness.providers.map((provider) => ({
      active: provider.active,
      baseUrlSources: provider.baseUrlSources,
      configured: provider.configured,
      credentialSources: provider.credentialSources,
      id: provider.id,
      label: provider.label,
      local: provider.local,
      notes: provider.notes,
      officialSurface: provider.officialSurface,
      registered: provider.registered,
      remediation: provider.remediation,
      status: provider.status,
    })),
    recommendations: readiness.recommendations,
    registeredCount: readiness.registeredCount,
  };
}

/**
 * Run a live write→read memory probe for a single provider (the discriminating
 * test beyond shape checks). Mirrors `buddy hermes memory probe <id> --json`.
 * Writes a bounded, non-secret marker and reads it back; surfaces verdict
 * pass/pending/fail without leaking stored content.
 */
export async function runHermesMemoryProbeForReview(
  providerId?: string,
): Promise<{ error?: string; ok: boolean; result?: HermesMemoryProbeResult }> {
  const mod = await loadCoreModule<HermesMemoryProbeModule>('agent/hermes-memory-providers.js');
  if (!mod?.probeMemoryProvider) {
    return { error: 'Core Hermes memory probe module is unavailable.', ok: false };
  }

  const id = providerId?.trim() || undefined;
  const probe = await mod.probeMemoryProvider(id);
  return {
    ok: probe.ok,
    result: {
      activeProviderId: probe.activeProviderId,
      error: probe.error,
      fellBackToLocal: probe.fellBackToLocal,
      generatedAt: probe.generatedAt,
      notes: probe.notes,
      ok: probe.ok,
      providerId: probe.providerId,
      remote: probe.remote,
      retrieved: probe.retrieved,
      retrievedSample: probe.retrievedSample,
      verdict: probe.verdict,
      wrote: probe.wrote,
    },
  };
}
