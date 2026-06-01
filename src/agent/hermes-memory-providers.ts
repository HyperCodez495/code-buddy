import { getMemoryProviderRegistry } from '../memory/memory-provider.js';

export type HermesMemoryProviderStatus = 'available' | 'configured' | 'fallback' | 'missing';

export interface HermesMemoryProviderItem {
  id: string;
  label: string;
  officialSurface: string;
  registered: boolean;
  active: boolean;
  local: boolean;
  configured: boolean;
  credentialSources: string[];
  baseUrlSources: string[];
  status: HermesMemoryProviderStatus;
  notes: string[];
  remediation: string[];
}

export interface HermesMemoryProvidersReadiness {
  generatedAt: string;
  ok: boolean;
  activeProviderId: string;
  registeredCount: number;
  configuredRemoteCount: number;
  fallbackCount: number;
  missingOfficialCount: number;
  providers: HermesMemoryProviderItem[];
  issues: string[];
  recommendations: string[];
}

export interface HermesMemoryProvidersReadinessOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface HermesMemoryProviderDefinition {
  id: string;
  label: string;
  officialSurface: string;
  credentialEnv: string[];
  baseUrlEnv: string[];
  local?: boolean;
  notes?: string[];
  remediation?: string[];
}

const OFFICIAL_MEMORY_PROVIDERS: HermesMemoryProviderDefinition[] = [
  {
    id: 'local',
    label: 'Code Buddy local memory',
    officialSurface: 'Built-in memory',
    credentialEnv: [],
    baseUrlEnv: [],
    local: true,
    notes: ['Durable local Code Buddy memory; no remote credential required.'],
  },
  {
    id: 'honcho',
    label: 'Honcho',
    officialSurface: 'Honcho external memory provider',
    credentialEnv: ['HONCHO_API_KEY'],
    baseUrlEnv: ['HONCHO_BASE_URL'],
    remediation: ['Set HONCHO_API_KEY before relying on the Honcho remote adapter.'],
  },
  {
    id: 'openviking',
    label: 'OpenViking',
    officialSurface: 'OpenViking external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    remediation: ['Add an OpenViking adapter before claiming full Hermes memory-provider parity.'],
  },
  {
    id: 'mem0',
    label: 'Mem0',
    officialSurface: 'Mem0 external memory provider',
    credentialEnv: ['MEM0_API_KEY'],
    baseUrlEnv: ['MEM0_BASE_URL'],
    remediation: ['Set MEM0_API_KEY before relying on the Mem0 remote adapter.'],
  },
  {
    id: 'hindsight',
    label: 'Hindsight',
    officialSurface: 'Hindsight external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    remediation: ['Add a Hindsight adapter before claiming full Hermes memory-provider parity.'],
  },
  {
    id: 'holographic',
    label: 'Holographic',
    officialSurface: 'Holographic external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    remediation: ['Add a Holographic adapter before claiming full Hermes memory-provider parity.'],
  },
  {
    id: 'retaindb',
    label: 'RetainDB',
    officialSurface: 'RetainDB external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    remediation: ['Add a RetainDB adapter before claiming full Hermes memory-provider parity.'],
  },
  {
    id: 'byterover',
    label: 'ByteRover',
    officialSurface: 'ByteRover external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    remediation: ['Add a ByteRover adapter before claiming full Hermes memory-provider parity.'],
  },
  {
    id: 'supermemory',
    label: 'Supermemory',
    officialSurface: 'Supermemory external memory provider',
    credentialEnv: ['SUPERMEMORY_API_KEY'],
    baseUrlEnv: ['SUPERMEMORY_BASE_URL'],
    remediation: ['Set SUPERMEMORY_API_KEY before relying on the Supermemory remote adapter.'],
  },
];

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function statusForProvider(input: {
  configured: boolean;
  local: boolean;
  registered: boolean;
}): HermesMemoryProviderStatus {
  if (!input.registered) return 'missing';
  if (input.local) return 'available';
  return input.configured ? 'configured' : 'fallback';
}

export function buildHermesMemoryProvidersReadiness(
  options: HermesMemoryProvidersReadinessOptions = {},
): HermesMemoryProvidersReadiness {
  const env = options.env ?? process.env;
  const registry = getMemoryProviderRegistry();
  const registeredIds = new Set(registry.list());
  const envProvider = env.CODEBUDDY_MEMORY_PROVIDER?.trim();
  const activeProviderId =
    envProvider && registeredIds.has(envProvider) ? envProvider : registry.getActiveId();

  const providers = OFFICIAL_MEMORY_PROVIDERS.map((definition) => {
    const credentialSources = presentEnvKeys(env, definition.credentialEnv);
    const baseUrlSources = presentEnvKeys(env, definition.baseUrlEnv);
    const registered = registeredIds.has(definition.id);
    const local = definition.local === true;
    const configured = local || credentialSources.length > 0;
    const status = statusForProvider({ configured, local, registered });
    const notes = [...(definition.notes ?? [])];

    if (status === 'fallback') {
      notes.push('Adapter is registered, but it will fall back to local memory until credentials are configured.');
    }

    return {
      id: definition.id,
      label: definition.label,
      officialSurface: definition.officialSurface,
      registered,
      active: definition.id === activeProviderId,
      local,
      configured,
      credentialSources,
      baseUrlSources,
      status,
      notes,
      remediation: definition.remediation ?? [],
    };
  });

  const issues: string[] = [];
  const recommendations: string[] = [];
  const activeProvider = providers.find((provider) => provider.active);

  if (envProvider && !registeredIds.has(envProvider)) {
    issues.push(`CODEBUDDY_MEMORY_PROVIDER points to unknown provider "${envProvider}".`);
  }

  if (!activeProvider) {
    issues.push(`Active memory provider "${activeProviderId}" is not in the Hermes provider matrix.`);
  } else if (activeProvider.status === 'fallback') {
    issues.push(
      `Active memory provider ${activeProvider.label} is missing credentials and will fall back to local memory.`,
    );
  } else if (activeProvider.status === 'missing') {
    issues.push(`Active memory provider ${activeProvider.label} is not implemented in Code Buddy.`);
  }

  const missingProviders = providers.filter((provider) => provider.status === 'missing');
  if (missingProviders.length > 0) {
    recommendations.push(
      `Missing official Hermes memory adapters: ${missingProviders.map((provider) => provider.label).join(', ')}.`,
    );
  }

  const fallbackProviders = providers.filter((provider) => provider.status === 'fallback');
  if (fallbackProviders.length > 0) {
    recommendations.push(
      `Configured remote memory currently requires credentials for: ${fallbackProviders.map((provider) => provider.label).join(', ')}.`,
    );
  }

  if (!activeProvider || activeProvider.local) {
    recommendations.push('Local memory is the durable default; configure a remote provider only when external recall is required.');
  }

  return {
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    ok: issues.length === 0,
    activeProviderId,
    registeredCount: providers.filter((provider) => provider.registered).length,
    configuredRemoteCount: providers.filter(
      (provider) => provider.registered && !provider.local && provider.configured,
    ).length,
    fallbackCount: fallbackProviders.length,
    missingOfficialCount: missingProviders.length,
    providers,
    issues,
    recommendations,
  };
}

export function renderHermesMemoryProvidersReadiness(
  readiness: HermesMemoryProvidersReadiness,
): string {
  const lines = [
    `Hermes memory providers: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `  Active: ${readiness.activeProviderId}`,
    `  Registered: ${readiness.registeredCount}/${readiness.providers.length}`,
    `  Configured remote: ${readiness.configuredRemoteCount}`,
    `  Local-fallback adapters: ${readiness.fallbackCount}`,
    `  Missing official adapters: ${readiness.missingOfficialCount}`,
    '',
    'Providers:',
  ];

  for (const provider of readiness.providers) {
    const activeMarker = provider.active ? '*' : ' ';
    const credentials =
      provider.credentialSources.length > 0 ? provider.credentialSources.join(', ') : 'none';
    const baseUrls = provider.baseUrlSources.length > 0 ? provider.baseUrlSources.join(', ') : 'none';
    lines.push(
      `${activeMarker} ${provider.status.padEnd(10)} ${provider.id.padEnd(12)} ${provider.label}`,
    );
    lines.push(`    Registered: ${provider.registered ? 'yes' : 'no'}; credentials: ${credentials}; base URL env: ${baseUrls}`);
    if (provider.notes.length > 0) {
      lines.push(`    Notes: ${provider.notes.join(' ')}`);
    }
    if (provider.remediation.length > 0) {
      lines.push(`    Remediation: ${provider.remediation.join(' ')}`);
    }
  }

  if (readiness.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of readiness.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  if (readiness.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const recommendation of readiness.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}
