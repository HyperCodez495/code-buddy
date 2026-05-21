import type { MobileSupervisionPairingState } from './mobile-supervision-pairing-state.js';

export const MOBILE_SUPERVISION_PAIRING_ACCEPTANCE_PLAN_SCHEMA_VERSION = 1;

export interface BuildMobileSupervisionPairingAcceptancePlanOptions {
  localOperatorLabel?: string;
  now?: Date | string;
}

export interface MobileSupervisionPairingAcceptancePlan {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_pairing_acceptance_plan';
  mode: 'acceptance_plan_only';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    codeFingerprint: string;
    deviceLabel: string;
    expiresAt: string;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: false;
  };
  acceptance: {
    canAcceptNow: false;
    localOperatorLabel: string;
    requestId: string;
    status: 'blocked_until_listener_exists';
    endpoint: {
      action: 'accept_pairing_code';
      enabled: false;
      method: 'POST';
      path: string;
    };
    requiredEvidence: string[];
  };
  preconditions: Array<{
    id: string;
    label: string;
    passed: boolean;
    evidence: string;
  }>;
  plannedMutations: Array<{
    id: string;
    enabled: false;
    description: string;
  }>;
  safety: {
    approvalMutationEndpointEnabled: false;
    autoAccept: false;
    localOnly: true;
    remoteExecutionDisabled: true;
    secretMaterialPersisted: false;
    serverStarted: false;
    tokenIssued: false;
  };
  operatorChecklist: string[];
}

export function buildMobileSupervisionPairingAcceptancePlan(
  pairingState: MobileSupervisionPairingState,
  options: BuildMobileSupervisionPairingAcceptancePlanOptions = {},
): MobileSupervisionPairingAcceptancePlan {
  const generatedAt = normalizeDate(options.now).toISOString();
  const localOperatorLabel = normalizeLocalOperatorLabel(options.localOperatorLabel);
  const codeNotExpired = new Date(pairingState.pairing.expiresAt).getTime() >= new Date(generatedAt).getTime();

  return {
    schemaVersion: MOBILE_SUPERVISION_PAIRING_ACCEPTANCE_PLAN_SCHEMA_VERSION,
    generatedAt,
    kind: 'mobile_supervision_pairing_acceptance_plan',
    mode: 'acceptance_plan_only',
    query: pairingState.query,
    basePath: pairingState.basePath,
    pairing: {
      acceptedByListener: false,
      codeFingerprint: pairingState.pairing.codeFingerprint,
      deviceLabel: pairingState.pairing.deviceLabel,
      expiresAt: pairingState.pairing.expiresAt,
      scopes: pairingState.pairing.scopes,
      status: pairingState.pairing.status,
      tokenIssued: false,
    },
    acceptance: {
      canAcceptNow: false,
      localOperatorLabel,
      requestId: `mobile-pairing-acceptance-${pairingState.pairing.codeFingerprint}`,
      status: 'blocked_until_listener_exists',
      endpoint: {
        action: 'accept_pairing_code',
        enabled: false,
        method: 'POST',
        path: `${pairingState.basePath}/pairing/accept`,
      },
      requiredEvidence: [
        'local_operator_confirmed_code',
        'loopback_listener_started_explicitly',
        'device_label_matches_pairing_request',
        'pairing_code_not_expired',
      ],
    },
    preconditions: [
      {
        id: 'preview_code_not_expired',
        label: 'Preview code is still within its TTL.',
        passed: codeNotExpired,
        evidence: `expiresAt=${pairingState.pairing.expiresAt}; checkedAt=${generatedAt}`,
      },
      {
        id: 'loopback_listener_running',
        label: 'A real loopback listener is running.',
        passed: false,
        evidence: `listenerStatus=${pairingState.listener.listenerStatus}; serverStarted=${pairingState.listener.serverStarted}`,
      },
      {
        id: 'local_operator_confirmation',
        label: 'A local operator confirmed the phone code.',
        passed: false,
        evidence: 'No operator confirmation is captured by this artifact.',
      },
      {
        id: 'no_existing_secret_material',
        label: 'No pairing secret or bearer token has already been persisted.',
        passed: !pairingState.pairing.persisted && !pairingState.pairing.tokenIssued,
        evidence: `persisted=${pairingState.pairing.persisted}; tokenIssued=${pairingState.pairing.tokenIssued}`,
      },
    ],
    plannedMutations: [
      {
        id: 'accept_pairing_session',
        enabled: false,
        description: 'Mark the pairing code as accepted by the local listener.',
      },
      {
        id: 'persist_pairing_session',
        enabled: false,
        description: 'Persist a short-lived pairing session for this device label.',
      },
      {
        id: 'mint_short_lived_mobile_token',
        enabled: false,
        description: 'Mint a short-lived bearer token scoped to mobile read/draft actions.',
      },
      {
        id: 'enable_mobile_approval_mutations',
        enabled: false,
        description: 'Enable approve/cancel mutations after explicit local acceptance.',
      },
    ],
    safety: {
      approvalMutationEndpointEnabled: false,
      autoAccept: false,
      localOnly: true,
      remoteExecutionDisabled: true,
      secretMaterialPersisted: false,
      serverStarted: false,
      tokenIssued: false,
    },
    operatorChecklist: [
      'Start a real loopback listener explicitly before accepting any phone code.',
      'Compare the phone-displayed code with the local preview code fingerprint.',
      'Confirm the device label and requested scopes before minting a token.',
      'Keep approve/cancel endpoints disabled until this acceptance plan is implemented and tested.',
      'Never let pairing acceptance execute tools, send outreach or expose secrets.',
    ],
  };
}

export function renderMobileSupervisionPairingAcceptancePlan(
  plan: MobileSupervisionPairingAcceptancePlan,
): string {
  const lines = [
    'Mobile supervision pairing acceptance plan',
    `Mode: ${plan.mode}`,
    `Status: ${plan.acceptance.status}`,
    `Device: ${plan.pairing.deviceLabel}`,
    `Endpoint: ${plan.acceptance.endpoint.method} ${plan.acceptance.endpoint.path} enabled=${plan.acceptance.endpoint.enabled}`,
    `Can accept now: ${plan.acceptance.canAcceptNow}`,
    `Safety: tokenIssued=${plan.safety.tokenIssued}; serverStarted=${plan.safety.serverStarted}; approvalMutationEndpointEnabled=${plan.safety.approvalMutationEndpointEnabled}`,
    '',
    'Preconditions:',
  ];

  for (const item of plan.preconditions) {
    lines.push(`- ${item.id}: passed=${item.passed}`);
    lines.push(`  ${item.evidence}`);
  }

  lines.push('');
  lines.push('Planned mutations:');
  for (const mutation of plan.plannedMutations) {
    lines.push(`- ${mutation.id}: enabled=${mutation.enabled}`);
  }

  lines.push('');
  lines.push('Operator checklist:');
  for (const item of plan.operatorChecklist) {
    lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

function normalizeDate(now: Date | string | undefined): Date {
  if (now instanceof Date) {
    return new Date(now);
  }
  if (typeof now === 'string') {
    const parsed = new Date(now);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function normalizeLocalOperatorLabel(label: string | undefined): string {
  const trimmed = label?.trim();
  if (!trimmed) {
    return 'local-operator';
  }
  return trimmed.slice(0, 64);
}
