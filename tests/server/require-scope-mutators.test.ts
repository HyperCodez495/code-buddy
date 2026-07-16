import type { AddressInfo } from 'net';
import { createApiKey } from '../../src/server/auth/api-keys.js';

interface MutatorCase {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

const mutators: MutatorCase[] = [
  { method: 'POST', path: '/api/routing/resolve', body: {} },
  { method: 'POST', path: '/api/cron/jobs/missing/trigger', body: {} },
  { method: 'POST', path: '/api/notifications/preferences', body: {} },
  { method: 'POST', path: '/api/webhooks', body: {} },
  { method: 'DELETE', path: '/api/webhooks/missing' },
  { method: 'POST', path: '/api/webhooks/missing/trigger', body: {} },
  { method: 'POST', path: '/api/heartbeat/start', body: {} },
  { method: 'POST', path: '/api/heartbeat/stop', body: {} },
  { method: 'POST', path: '/api/heartbeat/tick', body: {} },
  { method: 'POST', path: '/api/hub/install', body: {} },
  { method: 'DELETE', path: '/api/hub/missing' },
  { method: 'PUT', path: '/api/identity/test', body: {} },
  { method: 'POST', path: '/api/groups/block', body: {} },
  { method: 'DELETE', path: '/api/groups/block/missing' },
  { method: 'POST', path: '/api/auth-profiles', body: {} },
  { method: 'DELETE', path: '/api/auth-profiles/missing' },
  { method: 'POST', path: '/api/auth-profiles/reset', body: {} },
];

describe('inline mutator scope enforcement', () => {
  const jwtSecret = 'require-scope-mutators-test-secret';
  let baseUrl: string;
  let server: Awaited<ReturnType<typeof import('../../src/server/index.js')['startServer']>>['server'];
  let chatKey: string;
  let adminKey: string;
  let previousCsrfProtection: string | undefined;

  beforeAll(async () => {
    previousCsrfProtection = process.env.CSRF_PROTECTION;
    process.env.CSRF_PROTECTION = 'false';
    chatKey = createApiKey({
      name: 'mutator-chat-only',
      userId: 'mutator-chat-user',
      scopes: ['chat'],
    }).key;
    adminKey = createApiKey({
      name: 'mutator-admin',
      userId: 'mutator-admin-user',
      scopes: ['admin'],
    }).key;

    const { startServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    server = started.server;
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(server);
    }
    if (previousCsrfProtection === undefined) {
      delete process.env.CSRF_PROTECTION;
    } else {
      process.env.CSRF_PROTECTION = previousCsrfProtection;
    }
  });

  async function request(testCase: MutatorCase, key: string): Promise<Response> {
    return fetch(`${baseUrl}${testCase.path}`, {
      method: testCase.method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(testCase.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(testCase.body ? { body: JSON.stringify(testCase.body) } : {}),
    });
  }

  it.each(mutators)('rejects chat scope on $method $path', async (testCase) => {
    const response = await request(testCase, chatKey);

    expect(response.status).toBe(403);
  });

  it.each(mutators)('allows admin scope to reach $method $path', async (testCase) => {
    const response = await request(testCase, adminKey);

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
