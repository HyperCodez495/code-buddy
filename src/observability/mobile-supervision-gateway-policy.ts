import type {
  MobileSupervisionGatewayContract,
  MobileSupervisionGatewayMethod,
} from './mobile-supervision-gateway-contract.js';

export const MOBILE_SUPERVISION_GATEWAY_POLICY_SCHEMA_VERSION = 1;
export const MOBILE_SUPERVISION_GATEWAY_REVIEW_DRAFT_SCHEMA_VERSION = 1;

export interface MobileSupervisionGatewayRequest {
  action: string;
  method: MobileSupervisionGatewayMethod;
  path: string;
  hasLocalOperator?: boolean;
}

export interface MobileSupervisionGatewayRequestDecision {
  schemaVersion: 1;
  generatedAt: string;
  action: string;
  allowed: boolean;
  endpointId?: string;
  method: MobileSupervisionGatewayMethod;
  path: string;
  reason: string;
  requiresLocalOperator: boolean;
  sideEffects: 'none' | 'draft_only' | 'blocked';
}

export type MobileSupervisionGatewayReviewStatus =
  | 'ready'
  | 'needs_local_operator'
  | 'blocked';

export type MobileSupervisionGatewayReviewAction =
  | 'acknowledge'
  | 'approve_draft'
  | 'cancel_draft'
  | 'reject';

export interface MobileSupervisionGatewayReviewDraft {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_gateway_review_draft';
  draftId: string;
  query: string;
  request: MobileSupervisionGatewayRequest;
  decision: MobileSupervisionGatewayRequestDecision;
  status: MobileSupervisionGatewayReviewStatus;
  operatorActions: MobileSupervisionGatewayReviewAction[];
  safety: {
    autoDispatch: false;
    localOnly: true;
    localApprovalRequired: boolean;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

export function evaluateMobileSupervisionGatewayRequest(
  contract: MobileSupervisionGatewayContract,
  request: MobileSupervisionGatewayRequest,
): MobileSupervisionGatewayRequestDecision {
  const normalizedPath = normalizeRequestPath(request.path);
  const blockedOperation = contract.blockedOperations.find((operation) =>
    operation.action === request.action
  );
  if (blockedOperation) {
    return buildDecision(request, normalizedPath, false, {
      reason: blockedOperation.policy.reason,
      requiresLocalOperator: true,
      sideEffects: 'blocked',
    });
  }

  const endpoint = contract.endpoints.find((candidate) =>
    candidate.method === request.method &&
    candidate.action === request.action &&
    matchesEndpointPath(candidate.path, normalizedPath)
  );

  if (!endpoint) {
    return buildDecision(request, normalizedPath, false, {
      reason: 'No review-only mobile gateway endpoint matches this method, path and action.',
      requiresLocalOperator: true,
      sideEffects: 'blocked',
    });
  }

  if (!endpoint.policy.allowed) {
    return buildDecision(request, normalizedPath, false, {
      endpointId: endpoint.id,
      reason: endpoint.policy.reason,
      requiresLocalOperator: true,
      sideEffects: 'blocked',
    });
  }

  if (endpoint.localApprovalRequired && request.hasLocalOperator !== true) {
    return buildDecision(request, normalizedPath, false, {
      endpointId: endpoint.id,
      reason: 'This draft-only mobile action requires a local operator to review and approve the draft.',
      requiresLocalOperator: true,
      sideEffects: endpoint.sideEffects,
    });
  }

  return buildDecision(request, normalizedPath, true, {
    endpointId: endpoint.id,
    reason: 'Allowed by the review-only mobile gateway contract.',
    requiresLocalOperator: endpoint.localApprovalRequired,
    sideEffects: endpoint.sideEffects,
  });
}

export function renderMobileSupervisionGatewayRequestDecision(
  decision: MobileSupervisionGatewayRequestDecision,
): string {
  return [
    'Mobile supervision gateway request decision',
    `Allowed: ${decision.allowed}`,
    `Action: ${decision.action}`,
    `Route: ${decision.method} ${decision.path}`,
    `Endpoint: ${decision.endpointId ?? '(none)'}`,
    `Side effects: ${decision.sideEffects}`,
    `Local operator required: ${decision.requiresLocalOperator}`,
    `Reason: ${decision.reason}`,
  ].join('\n');
}

export function buildMobileSupervisionGatewayReviewDraft(
  query: string,
  contract: MobileSupervisionGatewayContract,
  request: MobileSupervisionGatewayRequest,
): MobileSupervisionGatewayReviewDraft {
  const decision = evaluateMobileSupervisionGatewayRequest(contract, request);
  const status = getReviewStatus(decision);

  return {
    schemaVersion: MOBILE_SUPERVISION_GATEWAY_REVIEW_DRAFT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_gateway_review_draft',
    draftId: buildReviewDraftId(request),
    query: query.trim(),
    request: {
      ...request,
      path: normalizeRequestPath(request.path),
    },
    decision,
    status,
    operatorActions: getReviewActions(status),
    safety: {
      autoDispatch: false,
      localOnly: true,
      localApprovalRequired: decision.requiresLocalOperator,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
    },
  };
}

export function renderMobileSupervisionGatewayReviewDraft(
  draft: MobileSupervisionGatewayReviewDraft,
): string {
  return [
    'Mobile supervision gateway review draft',
    `Status: ${draft.status}`,
    `Draft: ${draft.draftId}`,
    `Query: ${draft.query || '(empty)'}`,
    `Route: ${draft.request.method} ${draft.request.path}`,
    `Action: ${draft.request.action}`,
    `Decision: ${draft.decision.allowed ? 'allowed' : 'blocked'}`,
    `Operator actions: ${draft.operatorActions.join(', ')}`,
    `Safety: localOnly=${draft.safety.localOnly}; remoteExecutionDisabled=${draft.safety.remoteExecutionDisabled}; autoDispatch=${draft.safety.autoDispatch}`,
    `Reason: ${draft.decision.reason}`,
  ].join('\n');
}

function buildDecision(
  request: MobileSupervisionGatewayRequest,
  normalizedPath: string,
  allowed: boolean,
  options: {
    endpointId?: string;
    reason: string;
    requiresLocalOperator: boolean;
    sideEffects: MobileSupervisionGatewayRequestDecision['sideEffects'];
  },
): MobileSupervisionGatewayRequestDecision {
  return {
    schemaVersion: MOBILE_SUPERVISION_GATEWAY_POLICY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    action: request.action,
    allowed,
    endpointId: options.endpointId,
    method: request.method,
    path: normalizedPath,
    reason: options.reason,
    requiresLocalOperator: options.requiresLocalOperator,
    sideEffects: options.sideEffects,
  };
}

function getReviewStatus(
  decision: MobileSupervisionGatewayRequestDecision,
): MobileSupervisionGatewayReviewStatus {
  if (decision.allowed) {
    return 'ready';
  }
  if (decision.sideEffects === 'draft_only' && decision.requiresLocalOperator) {
    return 'needs_local_operator';
  }
  return 'blocked';
}

function getReviewActions(
  status: MobileSupervisionGatewayReviewStatus,
): MobileSupervisionGatewayReviewAction[] {
  switch (status) {
    case 'ready':
      return ['acknowledge'];
    case 'needs_local_operator':
      return ['approve_draft', 'cancel_draft'];
    case 'blocked':
      return ['reject'];
  }
}

function buildReviewDraftId(request: MobileSupervisionGatewayRequest): string {
  const action = request.action.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `mobile_gateway_${Date.now().toString(36)}_${action || 'request'}`;
}

function normalizeRequestPath(path: string): string {
  const trimmed = path.trim() || '/';
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/g, '') || '/';
}

function matchesEndpointPath(template: string, actual: string): boolean {
  const templateSegments = splitPath(template);
  const actualSegments = splitPath(actual);
  if (templateSegments.length !== actualSegments.length) {
    return false;
  }
  return templateSegments.every((segment, index) =>
    segment.startsWith(':') || segment === actualSegments[index]
  );
}

function splitPath(path: string): string[] {
  return normalizeRequestPath(path)
    .split('/')
    .filter(Boolean);
}
