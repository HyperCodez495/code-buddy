/**
 * Phase 7 — verify DesktopPermissionBridge emits a payload compatible
 * with Cowork's `PermissionRequest` shape so the existing
 * `PermissionDialog` renders correctly when the engine is the active
 * runner. The renderer now reads `bridgeId` to route the response back
 * via `permission.bridge.response`; without this normalisation, the
 * engine path silently deadlocked because the dialog couldn't read
 * `toolName` / `toolUseId` from the engine's native shape.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { DesktopPermissionBridge } from '../../src/desktop/permission-bridge';

describe('DesktopPermissionBridge — Cowork-compatible payload (Phase 7)', () => {
  it('emits a PermissionRequest with renderer-native field names', async () => {
    const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const bridge = new DesktopPermissionBridge((event) => {
      sent.push(event as { type: string; payload: Record<string, unknown> });
    });
    // Run the request — we don't await it (no response will ever arrive
    // in this test). We just want to inspect what was sent.
    void bridge.requestPermission({
      id: 'req_42',
      operation: 'bash',
      filename: 'rm -rf /tmp/foo',
      content: 'echo deleting',
    });

    expect(sent).toHaveLength(1);
    const event = sent[0];
    expect(event.type).toBe('permission.request');
    expect(event.payload).toMatchObject({
      toolUseId: 'req_42',
      toolName: 'bash',
      sessionId: 'engine',
      bridgeId: 'req_42',
    });
    // Filename / content / diffPreview are packed under `input`.
    const input = event.payload.input as Record<string, unknown>;
    expect(input.filename).toBe('rm -rf /tmp/foo');
    expect(input.content).toBe('echo deleting');
    bridge.cancelAll();
  });

  it('omits undefined optional fields from the input payload', async () => {
    const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const bridge = new DesktopPermissionBridge((e) =>
      sent.push(e as { type: string; payload: Record<string, unknown> }),
    );
    void bridge.requestPermission({ id: 'r', operation: 'edit', filename: 'a.ts' });
    const input = sent[0].payload.input as Record<string, unknown>;
    expect(input).toEqual({ filename: 'a.ts' });
    expect('content' in input).toBe(false);
    expect('diffPreview' in input).toBe(false);
    bridge.cancelAll();
  });

  it('auto-allows safe tools without emitting a request', async () => {
    const sent: Array<{ type: string }> = [];
    const bridge = new DesktopPermissionBridge((e) => sent.push(e as { type: string }));
    const decision = await bridge.requestPermission({
      id: 'r',
      operation: 'read_file',
      filename: 'a.ts',
    });
    expect(decision).toBe('allow');
    expect(sent).toHaveLength(0);
  });

  it('handleResponse resolves the pending request', async () => {
    const bridge = new DesktopPermissionBridge(() => undefined);
    const promise = bridge.requestPermission({
      id: 'r1',
      operation: 'write_file',
      filename: 'a.ts',
    });
    bridge.handleResponse('r1', 'allow_always');
    expect(await promise).toBe('allow_always');
  });

  it('cancelAll denies every pending request', async () => {
    const bridge = new DesktopPermissionBridge(() => undefined);
    const a = bridge.requestPermission({ id: 'a', operation: 'edit', filename: 'a' });
    const b = bridge.requestPermission({ id: 'b', operation: 'edit', filename: 'b' });
    bridge.cancelAll();
    expect(await a).toBe('deny');
    expect(await b).toBe('deny');
  });
});
