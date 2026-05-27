/**
 * Fleet two-peer mesh smoke test.
 *
 * Starts one real Gateway WebSocket server and connects two independent
 * FleetListener clients to it. The registry then exposes them as two
 * distinct peers so route_peer can prove multi-peer fan-out planning,
 * not just a single loopback path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { startServer, stopServer } from '../../src/server/index.js';
import { createApiKey } from '../../src/server/auth/api-keys.js';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { getFleetRegistry } from '../../src/fleet/fleet-registry.js';
import { resetCapabilityCache } from '../../src/fleet/capability-registry.js';
import { executeRoutePeer } from '../../src/tools/route-peer-tool.js';

type ServerHandle = Awaited<ReturnType<typeof startServer>>;

describe('Fleet two-peer mesh smoke', () => {
  const timeoutMs = 10_000;
  let tmpRoot = '';
  let serverHandle: ServerHandle | null = null;
  let listeners: FleetListener[] = [];
  let previousHome: string | undefined;
  let previousAuthPath: string | undefined;
  let previousChatGptModel: string | undefined;
  let previousPeerProvider: string | undefined;

  beforeEach(async () => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousAuthPath = process.env.CODEBUDDY_CODEX_AUTH_PATH;
    previousChatGptModel = process.env.CHATGPT_MODEL;
    previousPeerProvider = process.env.CODEBUDDY_PEER_PROVIDER;

    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-mesh-'));
    process.env.CODEBUDDY_HOME = tmpRoot;
    process.env.CODEBUDDY_CODEX_AUTH_PATH = path.join(tmpRoot, 'codex-auth.json');
    process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
    process.env.CODEBUDDY_PEER_PROVIDER = 'chatgpt-oauth';
    await fs.writeFile(
      process.env.CODEBUDDY_CODEX_AUTH_PATH,
      JSON.stringify({ tokens: { access_token: 'test-oauth-token' } }),
    );
    resetCapabilityCache();
    resetDatabaseManager();
    getFleetRegistry().clear();
  });

  afterEach(async () => {
    for (const listener of listeners) {
      await listener.disconnect().catch(() => undefined);
    }
    listeners = [];
    if (serverHandle) {
      await stopServer(serverHandle.server).catch(() => undefined);
      serverHandle = null;
    }
    getFleetRegistry().clear();
    resetCapabilityCache();
    resetDatabaseManager();

    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    if (previousAuthPath === undefined) {
      delete process.env.CODEBUDDY_CODEX_AUTH_PATH;
    } else {
      process.env.CODEBUDDY_CODEX_AUTH_PATH = previousAuthPath;
    }
    if (previousChatGptModel === undefined) {
      delete process.env.CHATGPT_MODEL;
    } else {
      process.env.CHATGPT_MODEL = previousChatGptModel;
    }
    if (previousPeerProvider === undefined) {
      delete process.env.CODEBUDDY_PEER_PROVIDER;
    } else {
      process.env.CODEBUDDY_PEER_PROVIDER = previousPeerProvider;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function connectMeshPeer(peerId: string, url: string, apiKey: string): Promise<void> {
    const listener = new FleetListener({
      url,
      apiKey,
      connectTimeoutMs: timeoutMs,
      authTimeoutMs: timeoutMs,
    });
    await listener.connect();
    listeners.push(listener);
    getFleetRegistry().register({
      id: peerId,
      url,
      startedAt: new Date(),
      eventCount: 0,
      autoReconnect: false,
      maxAttempts: 0,
      listener,
    });
  }

  it('plans a real two-peer Fleet route with primary, fallback and parallel lanes', async () => {
    const { key } = createApiKey({
      name: 'mesh-smoke',
      userId: 'test-mesh',
      scopes: ['fleet:listen', 'peer:invoke'],
    });
    serverHandle = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      rateLimit: false,
      logging: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = serverHandle.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${address.port}/ws`;

    await connectMeshPeer('mesh-alpha', url, key);
    await connectMeshPeer('mesh-beta', url, key);

    const result = await executeRoutePeer({
      prompt: 'review a multi-peer Fleet routing proof',
      privacyTag: 'public',
      parallelism: 2,
      timeoutMs,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      recommendation: expect.objectContaining({ peer: expect.any(String) }),
      fallback: expect.objectContaining({ peer: expect.any(String) }),
      parallel: expect.any(Array),
    });

    const data = result.data as {
      recommendation: { peer: string };
      fallback: { peer: string } | null;
      parallel: Array<{ peer: string }>;
      describeErrors: unknown[];
    };
    const plannedPeers = new Set([
      data.recommendation.peer,
      data.fallback?.peer,
      ...data.parallel.map((lane) => lane.peer),
    ].filter(Boolean));

    expect(plannedPeers).toEqual(new Set(['mesh-alpha', 'mesh-beta']));
    expect(data.parallel.map((lane) => lane.peer).sort()).toEqual(['mesh-alpha', 'mesh-beta']);
    expect(data.describeErrors).toHaveLength(0);
  }, 15_000);
});
