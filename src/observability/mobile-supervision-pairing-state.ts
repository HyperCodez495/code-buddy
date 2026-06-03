import { createHash, randomInt } from 'crypto';
import type { MobileSupervisionGatewayListenerShell } from './mobile-supervision-gateway-listener-shell.js';

export const MOBILE_SUPERVISION_PAIRING_STATE_SCHEMA_VERSION = 1;
export const MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS = 120;

export interface BuildMobileSupervisionPairingStateOptions {
  deviceLabel?: string;
  now?: Date | string;
  previewCode?: string;
  ttlSeconds?: number;
}

export interface MobileSupervisionPairingState {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_pairing_state';
  mode: 'local_pairing_plan';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    codeFingerprint: string;
    deviceLabel: string;
    deviceLabelMaxChars: number;
    expiresAt: string;
    persisted: false;
    previewCode: string;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: false;
    ttlSeconds: number;
  };
  listener: {
    bindStatus: MobileSupervisionGatewayListenerShell['bind']['status'];
    listenerStatus: MobileSupervisionGatewayListenerShell['transport']['listener'];
    networkExposure: MobileSupervisionGatewayListenerShell['bind']['networkExposure'];
    serverStarted: false;
  };
  safety: {
    approvalMutationsDisabled: true;
    notAcceptedByAnyServer: true;
    pairingRequiresLocalOperator: true;
    remoteExecutionDisabled: true;
    secretMaterialPersisted: false;
  };
  operatorChecklist: string[];
}

export function buildMobileSupervisionPairingState(
  shell: MobileSupervisionGatewayListenerShell,
  options: BuildMobileSupervisionPairingStateOptions = {},
): MobileSupervisionPairingState {
  const generatedAt = normalizeDate(options.now).toISOString();
  const ttlSeconds = normalizeTtlSeconds(options.ttlSeconds);
  const previewCode = normalizePreviewCode(options.previewCode ?? generatePreviewCode());
  const expiresAt = new Date(new Date(generatedAt).getTime() + ttlSeconds * 1000).toISOString();
  const deviceLabel = normalizeDeviceLabel(options.deviceLabel);

  return {
    schemaVersion: MOBILE_SUPERVISION_PAIRING_STATE_SCHEMA_VERSION,
    generatedAt,
    kind: 'mobile_supervision_pairing_state',
    mode: 'local_pairing_plan',
    query: shell.query,
    basePath: shell.basePath,
    pairing: {
      acceptedByListener: false,
      codeFingerprint: fingerprintPreviewCode(previewCode),
      deviceLabel,
      deviceLabelMaxChars: MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS,
      expiresAt,
      persisted: false,
      previewCode,
      scopes: shell.auth.scopes,
      status: 'preview_only',
      tokenIssued: false,
      ttlSeconds,
    },
    listener: {
      bindStatus: shell.bind.status,
      listenerStatus: shell.transport.listener,
      networkExposure: shell.bind.networkExposure,
      serverStarted: false,
    },
    safety: {
      approvalMutationsDisabled: true,
      notAcceptedByAnyServer: true,
      pairingRequiresLocalOperator: true,
      remoteExecutionDisabled: true,
      secretMaterialPersisted: false,
    },
    operatorChecklist: [
      'Show this preview code only on the local operator machine.',
      'Do not accept the code from a phone until a real loopback listener is explicitly started.',
      `Keep device labels at or below ${MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS} characters; oversized labels are rejected before token minting.`,
      'Pairing must mint a short-lived bearer token only after local operator confirmation.',
      'The paired phone may read snapshots, recall packs and artifact metadata, but may not execute tools.',
      'Draft follow-up prompts remain local-review artifacts until an operator approves them.',
    ],
  };
}

export function renderMobileSupervisionPairingState(
  state: MobileSupervisionPairingState,
): string {
  const lines = [
    'Mobile supervision pairing state',
    `Mode: ${state.mode}`,
    `Status: ${state.pairing.status}`,
    `Device: ${state.pairing.deviceLabel}`,
    `Device label limit: ${state.pairing.deviceLabelMaxChars} characters`,
    `Code: ${state.pairing.previewCode} (fingerprint ${state.pairing.codeFingerprint})`,
    `Expires: ${state.pairing.expiresAt} (${state.pairing.ttlSeconds}s)`,
    `Listener: ${state.listener.listenerStatus}, bind ${state.listener.bindStatus}, serverStarted=${state.listener.serverStarted}`,
    `Safety: tokenIssued=${state.pairing.tokenIssued}; persisted=${state.pairing.persisted}; remoteExecutionDisabled=${state.safety.remoteExecutionDisabled}`,
    '',
    'Operator checklist:',
  ];

  for (const item of state.operatorChecklist) {
    lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

function generatePreviewCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function normalizePreviewCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  return (digits || '000000').padStart(6, '0');
}

function fingerprintPreviewCode(code: string): string {
  return createHash('sha256')
    .update(`mobile-supervision-preview:${code}`, 'utf-8')
    .digest('hex')
    .slice(0, 16);
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

function normalizeTtlSeconds(ttlSeconds: number | undefined): number {
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    return 300;
  }
  return Math.min(900, Math.max(60, Math.floor(ttlSeconds)));
}

function normalizeDeviceLabel(label: string | undefined): string {
  const trimmed = label?.trim();
  if (!trimmed) {
    return 'mobile-supervisor';
  }
  return Array.from(trimmed).slice(0, MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS).join('');
}
