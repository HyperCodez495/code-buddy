import type {
  MobileSupervisionGatewayBlockedOperation,
  MobileSupervisionGatewayContract,
  MobileSupervisionGatewayEndpoint,
  MobileSupervisionGatewayMethod,
  MobileSupervisionGatewaySideEffect,
} from './mobile-supervision-gateway-contract.js';

export const MOBILE_SUPERVISION_GATEWAY_LISTENER_SHELL_SCHEMA_VERSION = 1;

export type MobileSupervisionGatewayListenerRouteHandler =
  | 'read_only_stub'
  | 'local_operator_review_stub'
  | 'blocked_stub';

export type MobileSupervisionGatewayListenerRouteStatus =
  | 'planned_not_bound'
  | 'blocked_by_policy';

export interface MobileSupervisionGatewayListenerRoute {
  action: string;
  handler: MobileSupervisionGatewayListenerRouteHandler;
  localApprovalRequired: boolean;
  method: MobileSupervisionGatewayMethod;
  path: string;
  policyReason: string;
  sideEffects: MobileSupervisionGatewaySideEffect | 'blocked';
  status: MobileSupervisionGatewayListenerRouteStatus;
}

export interface MobileSupervisionGatewayListenerShell {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_gateway_listener_shell';
  query: string;
  mode: 'disabled_shell';
  basePath: string;
  bind: {
    host: '127.0.0.1';
    networkExposure: 'loopback_only';
    port: 0;
    status: 'not_started';
  };
  auth: MobileSupervisionGatewayContract['auth'];
  transport: MobileSupervisionGatewayContract['transport'] & {
    listener: 'not_started';
  };
  safety: {
    localOperatorRequiredForDrafts: true;
    mutationRoutesDisabled: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
    serverStarted: false;
  };
  routes: MobileSupervisionGatewayListenerRoute[];
  blockedRoutes: MobileSupervisionGatewayListenerRoute[];
  acceptanceChecks: string[];
}

export function buildMobileSupervisionGatewayListenerShell(
  contract: MobileSupervisionGatewayContract,
): MobileSupervisionGatewayListenerShell {
  return {
    schemaVersion: MOBILE_SUPERVISION_GATEWAY_LISTENER_SHELL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_gateway_listener_shell',
    query: contract.query,
    mode: 'disabled_shell',
    basePath: contract.basePath,
    bind: {
      host: '127.0.0.1',
      networkExposure: 'loopback_only',
      port: 0,
      status: 'not_started',
    },
    auth: contract.auth,
    transport: {
      ...contract.transport,
      listener: 'not_started',
    },
    safety: {
      localOperatorRequiredForDrafts: true,
      mutationRoutesDisabled: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
      serverStarted: false,
    },
    routes: contract.endpoints.map(buildEndpointRoute),
    blockedRoutes: contract.blockedOperations.map(buildBlockedRoute),
    acceptanceChecks: [
      'No HTTP server is started by this shell.',
      'Only loopback binding is allowed before an explicit implementation step.',
      'Draft-only routes must return a local operator review draft, not dispatch work.',
      'Execution, mutation, outreach, secret-read and push operations stay blocked.',
      'Off-device access requires TLS plus bearer or pairing-code auth.',
    ],
  };
}

export function renderMobileSupervisionGatewayListenerShell(
  shell: MobileSupervisionGatewayListenerShell,
): string {
  const lines: string[] = [
    'Mobile supervision gateway listener shell',
    `Mode: ${shell.mode}`,
    `Base path: ${shell.basePath}`,
    `Bind: ${shell.bind.host}:${shell.bind.port} (${shell.bind.status}, ${shell.bind.networkExposure})`,
    `Transport: ${shell.transport.exposure}, listener ${shell.transport.listener}, remote execution ${shell.transport.remoteExecution}`,
    `Auth: ${shell.auth.scheme}, scopes=${shell.auth.scopes.join(', ')}, ttl=${shell.auth.ttlSeconds}s`,
    '',
    'Planned routes:',
  ];

  for (const route of shell.routes) {
    lines.push(`- ${route.method} ${route.path} -> ${route.handler}`);
    lines.push(`  action=${route.action}; sideEffects=${route.sideEffects}; localApprovalRequired=${route.localApprovalRequired}`);
  }

  lines.push('', 'Blocked route stubs:');
  for (const route of shell.blockedRoutes) {
    lines.push(`- ${route.action}: ${route.policyReason}`);
  }

  lines.push('', 'Acceptance checks:');
  for (const check of shell.acceptanceChecks) {
    lines.push(`- ${check}`);
  }

  return lines.join('\n');
}

function buildEndpointRoute(endpoint: MobileSupervisionGatewayEndpoint): MobileSupervisionGatewayListenerRoute {
  return {
    action: endpoint.action,
    handler: endpoint.sideEffects === 'draft_only' ? 'local_operator_review_stub' : 'read_only_stub',
    localApprovalRequired: endpoint.localApprovalRequired,
    method: endpoint.method,
    path: endpoint.path,
    policyReason: endpoint.policy.reason,
    sideEffects: endpoint.sideEffects,
    status: 'planned_not_bound',
  };
}

function buildBlockedRoute(
  operation: MobileSupervisionGatewayBlockedOperation,
): MobileSupervisionGatewayListenerRoute {
  return {
    action: operation.action,
    handler: 'blocked_stub',
    localApprovalRequired: true,
    method: 'POST',
    path: '/api/mobile/blocked',
    policyReason: operation.policy.reason,
    sideEffects: 'blocked',
    status: 'blocked_by_policy',
  };
}
