import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Server } from 'http';
import http from 'http';
import {
  mobileRouter,
  activePairingCode,
  activeTokens,
  followupDrafts,
  mobileEventBus,
  isDispatchEnabled,
} from '../../src/server/routes/mobile.js';

vi.mock('../../src/observability/mobile-supervision-snapshot.js', () => ({
  buildMobileSupervisionSnapshot: vi.fn().mockResolvedValue({ status: 'active', steps: [] }),
}));

vi.mock('../../src/observability/mobile-supervision-gateway-contract.js', () => ({
  buildMobileSupervisionGatewayContract: vi.fn().mockResolvedValue({ basePath: '/api/mobile' }),
}));

vi.mock('../../src/observability/mobile-supervision-gateway-policy.js', () => ({
  buildMobileSupervisionGatewayReviewDraft: vi.fn().mockReturnValue({ action: 'draft_followup_prompt' }),
}));

vi.mock('../../src/observability/run-store.js', () => ({
  getActiveRunStore: () => ({
    getRunsDir: () => '/tmp/mobile-sse-test-runs',
  }),
}));

describe('mobile SSE push events', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let port: number;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/mobile', mobileRouter);
    server = app.listen(0);
    const address = server.address();
    if (address && typeof address !== 'string') {
      port = address.port;
      baseUrl = `http://localhost:${port}/api/mobile`;
    }
  });

  afterAll(() => {
    server.close();
  });

  async function deviceToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'SSE-Test' }),
    });
    const { token } = await res.json() as any;
    return token;
  }

  // Helper: open a raw HTTP connection to the SSE endpoint and collect data chunks.
  function openSSE(
    token: string,
    opts: { useQueryParam?: boolean } = {},
  ): { chunks: string[]; close: () => void; response: Promise<http.IncomingMessage> } {
    const chunks: string[] = [];
    let reqHandle: http.ClientRequest;
    const response = new Promise<http.IncomingMessage>((resolve, reject) => {
      const pathStr = opts.useQueryParam
        ? `/api/mobile/events?token=${token}`
        : '/api/mobile/events';
      const headers: Record<string, string> = {};
      if (!opts.useQueryParam) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      reqHandle = http.get(
        { hostname: 'localhost', port, path: pathStr, headers },
        (res) => {
          resolve(res);
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString());
          });
        },
      );
      reqHandle.on('error', reject);
    });
    return {
      chunks,
      close: () => reqHandle.destroy(),
      response,
    };
  }

  it('SSE endpoint requires valid token', async () => {
    const res = await fetch(`${baseUrl}/events`);
    expect(res.status).toBe(401);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it('SSE endpoint rejects invalid token', async () => {
    const res = await fetch(`${baseUrl}/events`, {
      headers: { 'Authorization': 'Bearer invalid-token-value' },
    });
    expect(res.status).toBe(401);
  });

  it('SSE endpoint accepts valid token via Authorization header', async () => {
    const token = await deviceToken();
    const sse = openSSE(token);
    const res = await sse.response;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    sse.close();
  });

  it('SSE endpoint accepts valid token via query param', async () => {
    const token = await deviceToken();
    const sse = openSSE(token, { useQueryParam: true });
    const res = await sse.response;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    sse.close();
  });

  it('SSE emits events on draft approval', async () => {
    const token = await deviceToken();

    // Open SSE connection
    const sse = openSSE(token);
    await sse.response;

    // Small delay to let the connection establish
    await new Promise((r) => setTimeout(r, 50));

    // Submit + approve a draft
    const submitRes = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'SSE test prompt', query: 'test' }),
    });
    const { draft } = await submitRes.json() as any;

    // Wait for the draft creation SSE event
    await new Promise((r) => setTimeout(r, 50));

    // Approve via loopback
    await fetch(`${baseUrl}/followup-draft/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer: 'tester' }),
    });

    // Wait for SSE event propagation
    await new Promise((r) => setTimeout(r, 100));

    sse.close();

    // Parse collected SSE events
    const allData = sse.chunks.join('');
    const events = allData
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    // Should have draft creation event + draft approval event
    const draftEvents = events.filter(
      (e: any) => e.type === 'draft_status_changed' && e.draftId === draft.id,
    );
    expect(draftEvents.length).toBeGreaterThanOrEqual(2);
    expect(draftEvents.some((e: any) => e.status === 'needs_local_operator')).toBe(true);
    expect(draftEvents.some((e: any) => e.status === 'approved')).toBe(true);
  });

  it('SSE sends heartbeats', async () => {
    // We can't wait 30s for a real heartbeat, so we test via the event bus directly
    const token = await deviceToken();
    const sse = openSSE(token);
    await sse.response;

    // Manually emit a heartbeat-like event to verify the pipe works
    await new Promise((r) => setTimeout(r, 50));
    mobileEventBus.emit('event', { type: 'heartbeat', timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 50));

    sse.close();

    const allData = sse.chunks.join('');
    const events = allData
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    expect(events.some((e: any) => e.type === 'heartbeat')).toBe(true);
  });

  it('SSE cleans up listener on client disconnect', async () => {
    // Wait for any lingering connections from previous tests to close
    await new Promise((r) => setTimeout(r, 150));
    const initialCount = mobileEventBus.listenerCount('event');
    const token = await deviceToken();
    const sse = openSSE(token);
    const res = await sse.response;
    expect(res.statusCode).toBe(200);

    // Wait for the listener to be registered on the bus
    await new Promise((r) => setTimeout(r, 100));
    expect(mobileEventBus.listenerCount('event')).toBe(initialCount + 1);

    sse.close();
    // req.destroy() triggers an async chain: socket close → req 'close' event →
    // our cleanup handler. Give it enough time.
    await new Promise((r) => setTimeout(r, 250));

    expect(mobileEventBus.listenerCount('event')).toBe(initialCount);
  });
});

describe('mobile dispatch gating', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  const originalEnv = process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/mobile', mobileRouter);
    server = app.listen(0);
    const address = server.address();
    if (address && typeof address !== 'string') {
      baseUrl = `http://localhost:${address.port}/api/mobile`;
    }
  });

  afterAll(() => {
    server.close();
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH;
    } else {
      process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH = originalEnv;
    }
  });

  async function deviceToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Dispatch-Test' }),
    });
    const { token } = await res.json() as any;
    return token;
  }

  async function createApprovedDraft(token: string): Promise<any> {
    const submitRes = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Dispatch me', query: 'test' }),
    });
    const { draft } = await submitRes.json() as any;

    await fetch(`${baseUrl}/followup-draft/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer: 'operator' }),
    });

    return draft;
  }

  it('dispatch is OFF by default', () => {
    delete process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH;
    expect(isDispatchEnabled()).toBe(false);
  });

  it('dispatch is ON when env var is "true"', () => {
    process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH = 'true';
    expect(isDispatchEnabled()).toBe(true);
  });

  it('dispatch endpoint returns 403 when env var is OFF', async () => {
    delete process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH;
    const token = await deviceToken();
    const draft = await createApprovedDraft(token);

    const res = await fetch(`${baseUrl}/followup-draft/${draft.id}/dispatch`, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error).toContain('Dispatch is disabled');
  });

  it('dispatch endpoint queues the approved prompt when enabled', async () => {
    process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH = 'true';
    const token = await deviceToken();
    const draft = await createApprovedDraft(token);

    // Listen for dispatch event
    const dispatched: any[] = [];
    const listener = (payload: any) => dispatched.push(payload);
    mobileEventBus.on('dispatch', listener);

    const res = await fetch(`${baseUrl}/followup-draft/${draft.id}/dispatch`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.draft.status).toBe('dispatched');
    expect(typeof data.draft.dispatchedAt).toBe('number');

    // Verify dispatch event was emitted
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].draftId).toBe(draft.id);
    expect(dispatched[0].prompt).toBe('Dispatch me');

    mobileEventBus.off('dispatch', listener);
  });

  it('dispatch rejects a draft that is not approved', async () => {
    process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH = 'true';
    const token = await deviceToken();

    // Submit but DON'T approve
    const submitRes = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Not approved yet', query: 'test' }),
    });
    const { draft } = await submitRes.json() as any;

    const res = await fetch(`${baseUrl}/followup-draft/${draft.id}/dispatch`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const data = await res.json() as any;
    expect(data.error).toContain('must be approved');
  });

  it('dispatch rejects an already-dispatched draft', async () => {
    process.env.CODEBUDDY_MOBILE_ALLOW_DISPATCH = 'true';
    const token = await deviceToken();
    const draft = await createApprovedDraft(token);

    // First dispatch — success
    const first = await fetch(`${baseUrl}/followup-draft/${draft.id}/dispatch`, {
      method: 'POST',
    });
    expect(first.status).toBe(200);

    // Second dispatch — conflict
    const second = await fetch(`${baseUrl}/followup-draft/${draft.id}/dispatch`, {
      method: 'POST',
    });
    expect(second.status).toBe(409);
  });
});
