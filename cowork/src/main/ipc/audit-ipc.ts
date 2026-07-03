/**
 * `audit.*` IPC — the audit-log / observability surface (Claude Cowork
 * parity Phase 3 step 10): run listing + detail + search, the artifact-index
 * doctor status, recall-pack / trajectory / policy-eval / golden-workflow
 * reports, and the mobile-gateway review builders (snapshot/contract/review
 * draft/listener shell/pairing state+acceptance/approval queue) plus CSV
 * export. Every handler loads the audit-bridge lazily and never-throws with
 * a static fallback.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the
 * audit-bridge is imported lazily inside each handler with no mutable
 * capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/audit-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';

export function registerAuditIpcHandlers(): void {
  // Audit log — Claude Cowork parity Phase 3 step 10
  ipcMain.handle('audit.listRuns', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { listRuns } = await import('../observability/audit-bridge');
      return await listRuns(filter as never);
    } catch (err) {
      logError('[audit.listRuns] failed:', err);
      return [];
    }
  });

  ipcMain.handle('audit.getRunDetail', async (_event, runId: string) => {
    try {
      const { getRunDetail } = await import('../observability/audit-bridge');
      return await getRunDetail(runId);
    } catch (err) {
      logError('[audit.getRunDetail] failed:', err);
      return null;
    }
  });

  ipcMain.handle('audit.searchRuns', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { searchRuns } = await import('../observability/audit-bridge');
      return await searchRuns(filter as never);
    } catch (err) {
      logError('[audit.searchRuns] failed:', err);
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        query: '',
        filters: { limit: 20, sources: [] },
        count: 0,
        results: [],
      };
    }
  });

  ipcMain.handle('audit.getArtifactIndexDoctorStatus', async () => {
    try {
      const { getArtifactIndexDoctorStatus } = await import('../observability/audit-bridge');
      return await getArtifactIndexDoctorStatus();
    } catch (err) {
      logError('[audit.getArtifactIndexDoctorStatus] failed:', err);
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        kind: 'artifact_index_doctor_status',
        status: 'unavailable',
        unavailable: true,
        totalRows: 0,
        healthyRows: 0,
        staleRows: 0,
        orphanedRows: 0,
        rows: [],
        recommendations: [
          'Artifact index health is unavailable; verify the core RunStore and SQLite/FTS layer.',
        ],
        repairCommands: {
          staleOnly: 'buddy run index-doctor --repair',
          includeOrphans: 'buddy run index-doctor --repair --include-orphans',
        },
      };
    }
  });

  ipcMain.handle('audit.buildRecallPack', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { buildRecallPack } = await import('../observability/audit-bridge');
      return await buildRecallPack(filter as never);
    } catch (err) {
      logError('[audit.buildRecallPack] failed:', err);
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        query: '',
        filters: {
          limit: 20,
          maxMemories: 5,
          maxMatchesPerRun: 3,
          maxLessons: 5,
          maxSessions: 3,
          sources: [],
        },
        count: 0,
        lessonCount: 0,
        lessons: [],
        memories: [],
        memoryCount: 0,
        runCount: 0,
        results: [],
        runs: [],
        sessionCount: 0,
        sessions: [],
        promptContext: '# Run recall pack\nQuery: (empty)\n\nNo matching runs were found.',
      };
    }
  });

  ipcMain.handle('audit.buildTrajectoryExport', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { buildTrajectoryExport } = await import('../observability/audit-bridge');
      return await buildTrajectoryExport(filter as never);
    } catch (err) {
      logError('[audit.buildTrajectoryExport] failed:', err);
      return null;
    }
  });

  ipcMain.handle('audit.buildPolicyEvalReport', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { buildPolicyEvalReport } = await import('../observability/audit-bridge');
      return await buildPolicyEvalReport(filter as never);
    } catch (err) {
      logError('[audit.buildPolicyEvalReport] failed:', err);
      return null;
    }
  });

  ipcMain.handle(
    'audit.buildGoldenWorkflowEvalReport',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildGoldenWorkflowEvalReport } = await import('../observability/audit-bridge');
        return await buildGoldenWorkflowEvalReport(filter as never);
      } catch (err) {
        logError('[audit.buildGoldenWorkflowEvalReport] failed:', err);
        return null;
      }
    }
  );

  ipcMain.handle('audit.buildMobileSnapshot', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { buildMobileSnapshot } = await import('../observability/audit-bridge');
      return await buildMobileSnapshot(filter as never);
    } catch (err) {
      logError('[audit.buildMobileSnapshot] failed:', err);
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: 'review_only',
        query: '',
        safety: {
          autoDispatch: false,
          localApprovalRequired: true,
          outreachDisabled: true,
          remoteExecutionDisabled: true,
          redaction: 'secrets-redacted',
        },
        allowedActions: [
          'view_run_summary',
          'open_artifact',
          'copy_recall_pack',
          'draft_followup_prompt',
        ],
        blockedActions: [
          'execute_tool',
          'modify_files',
          'send_email',
          'approve_sensitive_operation',
          'read_secret_values',
          'push_changes',
        ],
        redactionCount: 0,
        recallPack: {
          count: 0,
          filters: {
            limit: 20,
            maxMemories: 5,
            maxMatchesPerRun: 3,
            maxLessons: 5,
            maxSessions: 3,
            sources: [],
          },
          lessonCount: 0,
          memoryCount: 0,
          promptContext: '# Run recall pack\nQuery: (empty)\n\nNo matching runs were found.',
          runCount: 0,
          schemaVersion: 1,
          sessionCount: 0,
        },
        runs: [],
      };
    }
  });

  ipcMain.handle(
    'audit.buildMobileGatewayContract',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobileGatewayContract } = await import('../observability/audit-bridge');
        return await buildMobileGatewayContract(filter as never);
      } catch (err) {
        logError('[audit.buildMobileGatewayContract] failed:', err);
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          mode: 'contract_only',
          basePath: '/api/mobile',
          query: '',
          auth: {
            required: true,
            scheme: 'bearer_or_pairing_code',
            scopes: ['mobile:read', 'mobile:draft'],
            ttlSeconds: 900,
          },
          transport: {
            exposure: 'local_first',
            offDeviceTlsRequired: true,
            remoteExecution: 'disabled',
          },
          endpoints: [],
          blockedOperations: [
            'execute_tool',
            'modify_files',
            'send_email',
            'approve_sensitive_operation',
            'read_secret_values',
            'push_changes',
          ].map((action) => ({
            action,
            policy: {
              action,
              allowed: false,
              requiresLocalOperator: true,
              reason:
                'Blocked because mobile supervision disables remote execution and requires local operator approval.',
            },
          })),
        };
      }
    }
  );

  ipcMain.handle(
    'audit.buildMobileGatewayReviewDraft',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobileGatewayReviewDraft } = await import('../observability/audit-bridge');
        return await buildMobileGatewayReviewDraft(filter as never);
      } catch (err) {
        logError('[audit.buildMobileGatewayReviewDraft] failed:', err);
        const method = String(filter?.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
        const action = String(filter?.action ?? 'view_run_summary').trim() || 'view_run_summary';
        const path = String(filter?.path ?? '/api/mobile/snapshot').trim() || '/api/mobile/snapshot';
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          query: String(filter?.query ?? '').trim(),
          draftId: `mobile-review-${method.toLowerCase()}-${action}`,
          contract: {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            mode: 'contract_only',
            basePath: '/api/mobile',
            query: String(filter?.query ?? '').trim(),
            auth: {
              required: true,
              scheme: 'bearer_or_pairing_code',
              scopes: ['mobile:read', 'mobile:draft'],
              ttlSeconds: 900,
            },
            transport: {
              exposure: 'local_first',
              offDeviceTlsRequired: true,
              remoteExecution: 'disabled',
            },
            endpoints: [],
            blockedOperations: [],
          },
          request: { action, method, path },
          decision: {
            action,
            allowed: false,
            method,
            path,
            reason: 'Review draft builder failed; blocked for local operator review.',
            requiresLocalOperator: true,
            sideEffects: 'none',
          },
          status: 'blocked',
          operatorActions: ['reject'],
          safety: {
            autoDispatch: false,
            localOnly: true,
            outreachDisabled: true,
            remoteExecutionDisabled: true,
          },
        };
      }
    }
  );

  ipcMain.handle(
    'audit.buildMobileGatewayListenerShell',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobileGatewayListenerShell } = await import('../observability/audit-bridge');
        return await buildMobileGatewayListenerShell(filter as never);
      } catch (err) {
        logError('[audit.buildMobileGatewayListenerShell] failed:', err);
        const query = String(filter?.query ?? '').trim();
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          kind: 'mobile_gateway_listener_shell',
          query,
          mode: 'disabled_shell',
          basePath: '/api/mobile',
          bind: {
            host: '127.0.0.1',
            networkExposure: 'loopback_only',
            port: 0,
            status: 'not_started',
          },
          auth: {
            required: true,
            scheme: 'bearer_or_pairing_code',
            scopes: ['mobile:read', 'mobile:draft'],
            ttlSeconds: 900,
          },
          transport: {
            exposure: 'local_first',
            offDeviceTlsRequired: true,
            remoteExecution: 'disabled',
            listener: 'not_started',
          },
          safety: {
            localOperatorRequiredForDrafts: true,
            mutationRoutesDisabled: true,
            outreachDisabled: true,
            remoteExecutionDisabled: true,
            serverStarted: false,
          },
          routes: [],
          blockedRoutes: [],
          acceptanceChecks: ['No HTTP server is started by this shell.'],
        };
      }
    }
  );

  ipcMain.handle(
    'audit.buildMobilePairingState',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobilePairingState } = await import('../observability/audit-bridge');
        return await buildMobilePairingState(filter as never);
      } catch (err) {
        logError('[audit.buildMobilePairingState] failed:', err);
        const rawTtlSeconds = Number(filter?.ttlSeconds);
        const ttlSeconds = Number.isFinite(rawTtlSeconds) ? rawTtlSeconds : 300;
        const generatedAt = new Date();
        return {
          schemaVersion: 1,
          generatedAt: generatedAt.toISOString(),
          kind: 'mobile_supervision_pairing_state',
          mode: 'local_pairing_plan',
          query: String(filter?.query ?? '').trim(),
          basePath: '/api/mobile',
          pairing: {
            acceptedByListener: false,
            codeFingerprint: 'unavailable',
            deviceLabel:
              String(filter?.deviceLabel ?? 'cowork-mobile-supervisor').trim() ||
              'cowork-mobile-supervisor',
            expiresAt: new Date(generatedAt.getTime() + ttlSeconds * 1000).toISOString(),
            persisted: false,
            previewCode: '000000',
            scopes: ['mobile:read', 'mobile:draft'],
            status: 'preview_only',
            tokenIssued: false,
            ttlSeconds,
          },
          listener: {
            bindStatus: 'not_started',
            listenerStatus: 'not_started',
            networkExposure: 'loopback_only',
            serverStarted: false,
          },
          safety: {
            approvalMutationsDisabled: true,
            notAcceptedByAnyServer: true,
            pairingRequiresLocalOperator: true,
            remoteExecutionDisabled: true,
            secretMaterialPersisted: false,
          },
          operatorChecklist: ['No listener accepts this preview code.'],
        };
      }
    }
  );

  ipcMain.handle(
    'audit.buildMobilePairingAcceptancePlan',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobilePairingAcceptancePlan } = await import('../observability/audit-bridge');
        return await buildMobilePairingAcceptancePlan(filter as never);
      } catch (err) {
        logError('[audit.buildMobilePairingAcceptancePlan] failed:', err);
        const query = String(filter?.query ?? '').trim();
        const deviceLabel =
          String(filter?.deviceLabel ?? 'cowork-mobile-supervisor').trim() ||
          'cowork-mobile-supervisor';
        const localOperatorLabel =
          String(filter?.localOperatorLabel ?? 'cowork-local-operator').trim() ||
          'cowork-local-operator';
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          kind: 'mobile_supervision_pairing_acceptance_plan',
          mode: 'acceptance_plan_only',
          query,
          basePath: '/api/mobile',
          pairing: {
            acceptedByListener: false,
            codeFingerprint: 'unavailable',
            deviceLabel,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            scopes: ['mobile:read', 'mobile:draft'],
            status: 'preview_only',
            tokenIssued: false,
          },
          acceptance: {
            canAcceptNow: false,
            localOperatorLabel,
            requestId: 'mobile-pairing-acceptance-unavailable',
            status: 'blocked_until_listener_exists',
            endpoint: {
              action: 'accept_pairing_code',
              enabled: false,
              method: 'POST',
              path: '/api/mobile/pairing/accept',
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
              id: 'loopback_listener_running',
              label: 'A real loopback listener is running.',
              passed: false,
              evidence: 'Fallback artifact; listener is not started.',
            },
          ],
          plannedMutations: [
            {
              id: 'mint_short_lived_mobile_token',
              enabled: false,
              description: 'Mint a short-lived bearer token scoped to mobile read/draft actions.',
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
          operatorChecklist: ['No pairing acceptance endpoint is enabled by this fallback artifact.'],
        };
      }
    }
  );

  ipcMain.handle(
    'audit.buildMobileApprovalQueue',
    async (_event, filter?: Record<string, unknown>) => {
      try {
        const { buildMobileApprovalQueue } = await import('../observability/audit-bridge');
        return await buildMobileApprovalQueue(filter as never);
      } catch (err) {
        logError('[audit.buildMobileApprovalQueue] failed:', err);
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          kind: 'mobile_supervision_approval_queue',
          mode: 'local_review_queue',
          query: String(filter?.query ?? '').trim(),
          basePath: '/api/mobile',
          pairing: {
            acceptedByListener: false,
            deviceLabel: 'cowork-mobile-supervisor',
            status: 'preview_only',
            tokenIssued: false,
          },
          listener: {
            listenerStatus: 'not_started',
            serverStarted: false,
          },
          counts: {
            blocked: 0,
            pending: 0,
            ready: 0,
            total: 0,
          },
          items: [],
          safety: {
            approvalMutationEndpointEnabled: false,
            autoDispatch: false,
            localOnly: true,
            outreachDisabled: true,
            remoteExecutionDisabled: true,
          },
        };
      }
    }
  );

  ipcMain.handle('audit.exportCsv', async (_event, filter?: Record<string, unknown>) => {
    try {
      const { exportCsv } = await import('../observability/audit-bridge');
      return await exportCsv(filter as never);
    } catch (err) {
      logError('[audit.exportCsv] failed:', err);
      return '';
    }
  });
}
