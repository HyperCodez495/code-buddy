import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getHermesMobileSupervisionForReview } from '../src/main/tools/hermes-mobile-supervision-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltMobileCore =
  fs.existsSync(path.join(distRoot, 'observability', 'mobile-supervision-gateway-contract.js')) &&
  fs.existsSync(path.join(distRoot, 'observability', 'mobile-supervision-gateway-listener-shell.js')) &&
  fs.existsSync(path.join(distRoot, 'observability', 'mobile-supervision-pairing-state.js')) &&
  fs.existsSync(path.join(distRoot, 'observability', 'mobile-supervision-approval-queue.js'));

describe.skipIf(!hasBuiltMobileCore)('Hermes mobile supervision bridge real core integration', () => {
  const originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;

  beforeEach(() => {
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads the real mobile supervision contract without leaking pairing secrets', async () => {
    const summary = await getHermesMobileSupervisionForReview('mobile supervision');

    expect(summary).toMatchObject({
      approvalQueue: {
        autoDispatch: false,
        localOnly: true,
        remoteExecutionDisabled: true,
      },
      command: 'buddy hermes mobile status "mobile supervision" --json',
      ok: true,
      routeMount: {
        basePath: '/api/mobile',
        module: 'src/server/routes/mobile.ts',
        serverCommand: 'buddy server --port 3000',
      },
      transport: {
        exposure: 'local_first',
        offDeviceTlsRequired: true,
        remoteExecution: 'disabled',
      },
    });
    expect(summary?.summary.readOnlyEndpoints).toBeGreaterThanOrEqual(3);
    expect(summary?.summary.draftOnlyEndpoints).toBeGreaterThanOrEqual(1);
    expect(summary?.summary.blockedOperations).toBeGreaterThan(0);
    expect(summary?.endpoints.map((endpoint) => endpoint.path)).toEqual(
      expect.arrayContaining(['/api/mobile/snapshot', '/api/mobile/followup-draft']),
    );
    expect(summary?.pairing).toMatchObject({
      deviceLabel: 'Cowork mobile supervisor',
      deviceLabelMaxChars: 120,
      status: 'preview_only',
      tokenIssued: false,
    });
    expect(JSON.stringify(summary)).not.toContain('previewCode');
    expect(JSON.stringify(summary)).not.toMatch(/\b\d{6}\b/);
  });
});
