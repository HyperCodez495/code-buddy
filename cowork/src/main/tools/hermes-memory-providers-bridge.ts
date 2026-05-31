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

interface HermesMemoryProvidersModule {
  buildHermesMemoryProvidersReadiness: () => HermesMemoryProvidersReadiness;
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
