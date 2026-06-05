import { loadCoreModule } from '../utils/core-loader';

export type HermesPortalToolKey = 'web' | 'image_gen' | 'tts' | 'browser' | 'modal';

export interface HermesPortalToolReviewItem {
  configured: boolean;
  credentialEnv: string[];
  currentProvider: string | null;
  key: HermesPortalToolKey;
  label: string;
  managedByNous: boolean;
  notes: string[];
  partner: string;
}

export interface HermesPortalReview {
  command: string;
  configuredToolCount: number;
  generatedAt: string;
  loggedIn: boolean;
  managedByNousCount: number;
  notConfiguredToolCount: number;
  notes: string[];
  ok: boolean;
  portal: {
    authFilePresent: boolean;
    credentialPresent: boolean;
    credentialSources: string[];
    docsUrl: string;
    portalBaseUrl: string;
    selectedInferenceProvider: string | null;
    selectedModel: string | null;
    selectedViaNous: boolean;
    subscriptionUrl: string;
    toolGatewayConfigured: boolean;
    toolGatewayUrl: string | null;
  };
  routingActive: boolean;
  tools: HermesPortalToolReviewItem[];
}

interface HermesPortalStatusModule {
  buildHermesPortalStatus: () => {
    generatedAt: string;
    portal: {
      authFilePresent: boolean;
      credentialPresent: boolean;
      credentialSources: string[];
      docsUrl: string;
      loggedIn: boolean;
      portalBaseUrl: string;
      selectedInferenceProvider: string | null;
      selectedModel: string | null;
      selectedViaNous: boolean;
      subscriptionUrl: string;
      toolGatewayConfigured: boolean;
      toolGatewayUrl: string | null;
    };
    toolGateway: {
      configuredCount: number;
      managedByNousCount: number;
      notConfiguredCount: number;
      routingActive: boolean;
      tools: HermesPortalToolReviewItem[];
    };
    notes: string[];
  };
}

/**
 * Read-only review of the Nous Portal / Tool Gateway readiness for Cowork.
 * Mirrors `buddy hermes portal status --json` — surfaces no secret values,
 * only credential *source* names.
 */
export async function getHermesPortalForReview(): Promise<HermesPortalReview | null> {
  const mod = await loadCoreModule<HermesPortalStatusModule>('agent/hermes-portal-status.js');
  if (!mod?.buildHermesPortalStatus) return null;

  const status = mod.buildHermesPortalStatus();
  const tools = status.toolGateway.tools.map((tool) => ({
    configured: tool.configured,
    credentialEnv: tool.credentialEnv,
    currentProvider: tool.currentProvider,
    key: tool.key,
    label: tool.label,
    managedByNous: tool.managedByNous,
    notes: tool.notes,
    partner: tool.partner,
  }));

  // "ok" = portal usable: either logged in, or all gateway tools resolved
  // (configured or managed by Nous) so outbound calls won't fail.
  const ok = status.portal.loggedIn || status.toolGateway.notConfiguredCount === 0;

  return {
    command: 'buddy hermes portal status --json',
    configuredToolCount: status.toolGateway.configuredCount,
    generatedAt: status.generatedAt,
    loggedIn: status.portal.loggedIn,
    managedByNousCount: status.toolGateway.managedByNousCount,
    notConfiguredToolCount: status.toolGateway.notConfiguredCount,
    notes: status.notes,
    ok,
    portal: {
      authFilePresent: status.portal.authFilePresent,
      credentialPresent: status.portal.credentialPresent,
      credentialSources: status.portal.credentialSources,
      docsUrl: status.portal.docsUrl,
      portalBaseUrl: status.portal.portalBaseUrl,
      selectedInferenceProvider: status.portal.selectedInferenceProvider,
      selectedModel: status.portal.selectedModel,
      selectedViaNous: status.portal.selectedViaNous,
      subscriptionUrl: status.portal.subscriptionUrl,
      toolGatewayConfigured: status.portal.toolGatewayConfigured,
      toolGatewayUrl: status.portal.toolGatewayUrl,
    },
    routingActive: status.toolGateway.routingActive,
    tools,
  };
}
