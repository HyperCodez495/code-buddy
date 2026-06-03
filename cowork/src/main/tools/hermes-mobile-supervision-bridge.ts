import { loadCoreModule } from '../utils/core-loader';

export interface HermesMobileSupervisionEndpointReview {
  action: string;
  id: string;
  localApprovalRequired: boolean;
  method: 'GET' | 'POST';
  path: string;
  sideEffects: 'none' | 'draft_only';
}

export interface HermesMobileSupervisionReview {
  approvalQueue: {
    autoDispatch: boolean;
    counts: {
      blocked: number;
      pending: number;
      ready: number;
      total: number;
    };
    localOnly: boolean;
    remoteExecutionDisabled: boolean;
  };
  auth: {
    scheme: 'bearer_or_pairing_code';
    scopes: string[];
    ttlSeconds: number;
  };
  blockedOperations: Array<{
    action: string;
    reason: string;
  }>;
  command: string;
  endpoints: HermesMobileSupervisionEndpointReview[];
  generatedAt: string;
  ok: boolean;
  pairing: {
    deviceLabel: string;
    deviceLabelMaxChars: number;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: boolean;
    ttlSeconds: number;
  };
  query: string;
  recommendations: string[];
  routeMount: {
    basePath: string;
    module: string;
    mountedBy: string;
    serverCommand: string;
    status: 'implemented_not_probed';
  };
  summary: {
    blockedOperations: number;
    blockedQueueItems: number;
    draftOnlyEndpoints: number;
    pendingLocalApproval: number;
    readOnlyEndpoints: number;
    readyReadOnly: number;
    totalQueueItems: number;
  };
  transport: {
    exposure: 'local_first';
    offDeviceTlsRequired: boolean;
    remoteExecution: 'disabled';
  };
}

interface MobileSupervisionGatewayContract {
  auth: HermesMobileSupervisionReview['auth'];
  basePath: string;
  blockedOperations: Array<{
    action: string;
    policy: {
      reason: string;
    };
  }>;
  endpoints: HermesMobileSupervisionEndpointReview[];
  generatedAt: string;
  query: string;
  transport: HermesMobileSupervisionReview['transport'];
}

interface MobileSupervisionGatewayListenerShell {
  pairing?: never;
}

interface MobileSupervisionPairingState {
  pairing: HermesMobileSupervisionReview['pairing'] & {
    previewCode?: string;
  };
}

interface MobileSupervisionApprovalQueue {
  counts: HermesMobileSupervisionReview['approvalQueue']['counts'];
  safety: {
    autoDispatch: boolean;
    localOnly: boolean;
    remoteExecutionDisabled: boolean;
  };
}

interface MobileSupervisionGatewayContractModule {
  buildMobileSupervisionGatewayContract: (
    query: string,
    options?: {
      includeAllContext?: boolean;
      includeSnapshot?: boolean;
      limit?: number;
    },
  ) => Promise<MobileSupervisionGatewayContract>;
}

interface MobileSupervisionGatewayListenerShellModule {
  buildMobileSupervisionGatewayListenerShell: (
    contract: MobileSupervisionGatewayContract,
  ) => MobileSupervisionGatewayListenerShell;
}

interface MobileSupervisionPairingStateModule {
  buildMobileSupervisionPairingState: (
    shell: MobileSupervisionGatewayListenerShell,
    options?: {
      deviceLabel?: string;
    },
  ) => MobileSupervisionPairingState;
}

interface MobileSupervisionApprovalQueueModule {
  buildMobileSupervisionApprovalQueue: (
    contract: MobileSupervisionGatewayContract,
    pairingState: MobileSupervisionPairingState,
  ) => MobileSupervisionApprovalQueue;
}

export async function getHermesMobileSupervisionForReview(
  query = 'mobile supervision',
): Promise<HermesMobileSupervisionReview | null> {
  const [contractMod, listenerMod, pairingMod, approvalMod] = await Promise.all([
    loadCoreModule<MobileSupervisionGatewayContractModule>(
      'observability/mobile-supervision-gateway-contract.js',
    ),
    loadCoreModule<MobileSupervisionGatewayListenerShellModule>(
      'observability/mobile-supervision-gateway-listener-shell.js',
    ),
    loadCoreModule<MobileSupervisionPairingStateModule>(
      'observability/mobile-supervision-pairing-state.js',
    ),
    loadCoreModule<MobileSupervisionApprovalQueueModule>(
      'observability/mobile-supervision-approval-queue.js',
    ),
  ]);

  if (
    !contractMod?.buildMobileSupervisionGatewayContract ||
    !listenerMod?.buildMobileSupervisionGatewayListenerShell ||
    !pairingMod?.buildMobileSupervisionPairingState ||
    !approvalMod?.buildMobileSupervisionApprovalQueue
  ) {
    return null;
  }

  const normalizedQuery = query.trim() || 'mobile supervision';
  const contract = await contractMod.buildMobileSupervisionGatewayContract(normalizedQuery, {
    includeAllContext: false,
    includeSnapshot: false,
    limit: 20,
  });
  const listenerShell = listenerMod.buildMobileSupervisionGatewayListenerShell(contract);
  const pairingState = pairingMod.buildMobileSupervisionPairingState(listenerShell, {
    deviceLabel: 'Cowork mobile supervisor',
  });
  const approvalQueue = approvalMod.buildMobileSupervisionApprovalQueue(contract, pairingState);
  const readOnlyEndpoints = contract.endpoints.filter((endpoint) => endpoint.sideEffects === 'none');
  const draftOnlyEndpoints = contract.endpoints.filter((endpoint) => endpoint.sideEffects === 'draft_only');

  return {
    approvalQueue: {
      autoDispatch: approvalQueue.safety.autoDispatch,
      counts: approvalQueue.counts,
      localOnly: approvalQueue.safety.localOnly,
      remoteExecutionDisabled: approvalQueue.safety.remoteExecutionDisabled,
    },
    auth: contract.auth,
    blockedOperations: contract.blockedOperations.map((operation) => ({
      action: operation.action,
      reason: operation.policy.reason,
    })),
    command: `buddy hermes mobile status "${contract.query}" --json`,
    endpoints: contract.endpoints.map((endpoint) => ({
      action: endpoint.action,
      id: endpoint.id,
      localApprovalRequired: endpoint.localApprovalRequired,
      method: endpoint.method,
      path: endpoint.path,
      sideEffects: endpoint.sideEffects,
    })),
    generatedAt: contract.generatedAt,
    ok: true,
    pairing: {
      deviceLabel: pairingState.pairing.deviceLabel,
      deviceLabelMaxChars: pairingState.pairing.deviceLabelMaxChars,
      scopes: pairingState.pairing.scopes,
      status: pairingState.pairing.status,
      tokenIssued: pairingState.pairing.tokenIssued,
      ttlSeconds: pairingState.pairing.ttlSeconds,
    },
    query: contract.query,
    recommendations: [
      'Start the embedded server before pairing a phone.',
      'Keep pairing and approval routes loopback-only for the local operator.',
      `Keep mobile pairing device labels at or below ${pairingState.pairing.deviceLabelMaxChars} characters.`,
      'Mobile follow-up prompts stay draft-only until reviewed locally.',
    ],
    routeMount: {
      basePath: contract.basePath,
      module: 'src/server/routes/mobile.ts',
      mountedBy: 'src/server/index.ts',
      serverCommand: 'buddy server --port 3000',
      status: 'implemented_not_probed',
    },
    summary: {
      blockedOperations: contract.blockedOperations.length,
      blockedQueueItems: approvalQueue.counts.blocked,
      draftOnlyEndpoints: draftOnlyEndpoints.length,
      pendingLocalApproval: approvalQueue.counts.pending,
      readOnlyEndpoints: readOnlyEndpoints.length,
      readyReadOnly: approvalQueue.counts.ready,
      totalQueueItems: approvalQueue.counts.total,
    },
    transport: contract.transport,
  };
}
