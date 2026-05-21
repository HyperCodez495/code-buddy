import type {
  MobileSupervisionGatewayContract,
  MobileSupervisionGatewayEndpoint,
  MobileSupervisionGatewayMethod,
} from './mobile-supervision-gateway-contract.js';
import {
  buildMobileSupervisionGatewayReviewDraft,
  type MobileSupervisionGatewayReviewAction,
  type MobileSupervisionGatewayReviewDraft,
  type MobileSupervisionGatewayReviewStatus,
} from './mobile-supervision-gateway-policy.js';
import type { MobileSupervisionPairingState } from './mobile-supervision-pairing-state.js';

export const MOBILE_SUPERVISION_APPROVAL_QUEUE_SCHEMA_VERSION = 1;

export type MobileSupervisionApprovalQueueItemStatus =
  | 'ready_read_only'
  | 'pending_local_operator'
  | 'blocked_by_policy';

export interface MobileSupervisionApprovalQueueItem {
  id: string;
  source: 'gateway_endpoint' | 'blocked_operation';
  action: string;
  description: string;
  method: MobileSupervisionGatewayMethod;
  path: string;
  status: MobileSupervisionApprovalQueueItemStatus;
  operatorActions: MobileSupervisionGatewayReviewAction[];
  reason: string;
  localApprovalRequired: boolean;
  canDispatch: false;
  reviewDraft?: MobileSupervisionGatewayReviewDraft;
}

export interface MobileSupervisionApprovalQueue {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_approval_queue';
  mode: 'local_review_queue';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    deviceLabel: string;
    status: 'preview_only';
    tokenIssued: false;
  };
  listener: {
    listenerStatus: 'not_started';
    serverStarted: false;
  };
  counts: {
    blocked: number;
    pending: number;
    ready: number;
    total: number;
  };
  items: MobileSupervisionApprovalQueueItem[];
  safety: {
    approvalMutationEndpointEnabled: false;
    autoDispatch: false;
    localOnly: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

export function buildMobileSupervisionApprovalQueue(
  contract: MobileSupervisionGatewayContract,
  pairingState: MobileSupervisionPairingState,
): MobileSupervisionApprovalQueue {
  const endpointItems = contract.endpoints.map((endpoint) =>
    buildEndpointItem(contract, pairingState.query, endpoint)
  );
  const blockedItems = contract.blockedOperations.map((operation) => {
    const draft = buildMobileSupervisionGatewayReviewDraft(pairingState.query, contract, {
      action: operation.action,
      method: 'POST',
      path: `${contract.basePath}/blocked`,
    });
    return buildQueueItem(
      `blocked.${operation.action}`,
      'blocked_operation',
      'Blocked mobile operation stub.',
      draft,
    );
  });
  const items = [...endpointItems, ...blockedItems];

  return {
    schemaVersion: MOBILE_SUPERVISION_APPROVAL_QUEUE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_supervision_approval_queue',
    mode: 'local_review_queue',
    query: contract.query,
    basePath: contract.basePath,
    pairing: {
      acceptedByListener: false,
      deviceLabel: pairingState.pairing.deviceLabel,
      status: pairingState.pairing.status,
      tokenIssued: false,
    },
    listener: {
      listenerStatus: pairingState.listener.listenerStatus,
      serverStarted: false,
    },
    counts: {
      blocked: items.filter((item) => item.status === 'blocked_by_policy').length,
      pending: items.filter((item) => item.status === 'pending_local_operator').length,
      ready: items.filter((item) => item.status === 'ready_read_only').length,
      total: items.length,
    },
    items,
    safety: {
      approvalMutationEndpointEnabled: false,
      autoDispatch: false,
      localOnly: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
    },
  };
}

export function renderMobileSupervisionApprovalQueue(
  queue: MobileSupervisionApprovalQueue,
): string {
  const lines = [
    'Mobile supervision approval queue',
    `Mode: ${queue.mode}`,
    `Query: ${queue.query || '(empty)'}`,
    `Pairing: ${queue.pairing.status}, tokenIssued=${queue.pairing.tokenIssued}`,
    `Listener: ${queue.listener.listenerStatus}, serverStarted=${queue.listener.serverStarted}`,
    `Counts: ready=${queue.counts.ready}; pending=${queue.counts.pending}; blocked=${queue.counts.blocked}`,
    `Safety: autoDispatch=${queue.safety.autoDispatch}; approvalMutationEndpointEnabled=${queue.safety.approvalMutationEndpointEnabled}; remoteExecutionDisabled=${queue.safety.remoteExecutionDisabled}`,
    '',
    'Items:',
  ];

  for (const item of queue.items) {
    lines.push(`- ${item.status}: ${item.method} ${item.path} -> ${item.action}`);
    lines.push(`  actions=${item.operatorActions.join(', ')}; canDispatch=${item.canDispatch}`);
    lines.push(`  ${item.reason}`);
  }

  return lines.join('\n');
}

function buildEndpointItem(
  contract: MobileSupervisionGatewayContract,
  query: string,
  endpoint: MobileSupervisionGatewayEndpoint,
): MobileSupervisionApprovalQueueItem {
  const draft = buildMobileSupervisionGatewayReviewDraft(query, contract, {
    action: endpoint.action,
    method: endpoint.method,
    path: endpoint.path,
  });
  return buildQueueItem(
    endpoint.id,
    'gateway_endpoint',
    endpoint.description,
    draft,
  );
}

function buildQueueItem(
  id: string,
  source: MobileSupervisionApprovalQueueItem['source'],
  description: string,
  draft: MobileSupervisionGatewayReviewDraft,
): MobileSupervisionApprovalQueueItem {
  return {
    id,
    source,
    action: draft.request.action,
    description,
    method: draft.request.method,
    path: draft.request.path,
    status: mapReviewStatus(draft.status),
    operatorActions: draft.operatorActions,
    reason: draft.decision.reason,
    localApprovalRequired: draft.decision.requiresLocalOperator,
    canDispatch: false,
    reviewDraft: draft.status === 'needs_local_operator' ? draft : undefined,
  };
}

function mapReviewStatus(
  status: MobileSupervisionGatewayReviewStatus,
): MobileSupervisionApprovalQueueItemStatus {
  switch (status) {
    case 'ready':
      return 'ready_read_only';
    case 'needs_local_operator':
      return 'pending_local_operator';
    case 'blocked':
      return 'blocked_by_policy';
  }
}
