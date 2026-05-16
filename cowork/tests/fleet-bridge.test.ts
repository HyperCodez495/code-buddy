import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const tmpDir = path.join(os.tmpdir(), `cowork-fleet-bridge-${Date.now()}`);

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => tmpDir,
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

class FakeFleetListener extends EventEmitter {
  static instances: FakeFleetListener[] = [];
  options: { url: string; apiKey?: string };
  connected = false;

  constructor(options: { url: string; apiKey?: string }) {
    super();
    this.options = options;
    FakeFleetListener.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connected = true;
    setImmediate(() => {
      this.emit('connected');
      this.emit('authenticated');
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  async request(method: string): Promise<unknown> {
    if (method !== 'peer.describe') {
      throw new Error(`unexpected method: ${method}`);
    }
    return {
      peerChatProvider: {
        provider: 'chatgpt-oauth',
        model: 'gpt-5.1-codex',
        isLocal: false,
      },
      capabilities: {
        egress: 'cloud',
        machineLabel: 'Ministar Linux',
        models: [
          {
            id: 'gpt-5.1-codex',
            contextWindow: 200_000,
            strengths: ['reasoning', 'thinking', 'code'],
            provider: 'chatgpt-oauth',
          },
        ],
      },
    };
  }
}

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => ({ FleetListener: FakeFleetListener })),
}));

import { FleetBridge } from '../src/main/fleet/fleet-bridge';
import type { ServerEvent } from '../src/renderer/types';

describe('FleetBridge', () => {
  beforeEach(async () => {
    FakeFleetListener.instances = [];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('addPeer persists, connects, and emits authenticated peer.update', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    const result = await bridge.addPeer({
      url: 'ws://100.98.18.76:3000/ws',
      apiKey: 'test-key',
      label: 'Ministar Linux',
    });
    expect(result.success).toBe(true);
    expect(result.peer?.id).toBe('ministar-linux');

    // Wait for the listener event chain
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const updates = events.filter((e) => e.type === 'fleet.peer.update');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const last = updates[updates.length - 1];
    expect(last.payload.peer.status).toBe('authenticated');

    // Persistence
    const raw = await fs.readFile(
      path.join(tmpDir, 'fleet-peers.json'),
      'utf-8'
    );
    const parsed = JSON.parse(raw);
    expect(parsed.peers[0].url).toBe('ws://100.98.18.76:3000/ws');
    expect(parsed.peers[0].apiKey).toBe('test-key');
  });

  it('refreshes peer.describe capabilities for Cowork routing and display', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    const result = await bridge.addPeer({
      url: 'ws://100.98.18.76:3000/ws',
      apiKey: 'test-key',
      label: 'Ministar Linux',
    });
    expect(result.success).toBe(true);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const peers = await bridge.listPeers();
    expect(peers[0].peerChatProvider).toEqual({
      provider: 'chatgpt-oauth',
      model: 'gpt-5.1-codex',
      isLocal: false,
    });
    expect(peers[0].capability).toMatchObject({
      egress: 'cloud',
      machineLabel: 'Ministar Linux',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
        },
      ],
    });

    const updates = events.filter((e) => e.type === 'fleet.peer.update');
    expect(
      updates.some((e) => Boolean(e.payload.peer.capability?.models.length)),
    ).toBe(true);
  });

  it('forwards fleet:event payloads as fleet.event ServerEvents', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    await bridge.addPeer({
      url: 'ws://example/ws',
      apiKey: 'k',
      label: 'spoke-1',
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const listener = FakeFleetListener.instances[0];
    listener.emit('fleet:event', {
      type: 'fleet:agent:tool_started',
      payload: {
        toolName: 'view_file',
        source: { hostname: 'ministar', agentId: 'agent-1' },
      },
    });

    await new Promise((r) => setImmediate(r));
    const fleetEvents = events.filter((e) => e.type === 'fleet.event');
    expect(fleetEvents).toHaveLength(1);
    expect(fleetEvents[0].payload.type).toBe('fleet:agent:tool_started');
    expect(fleetEvents[0].payload.hostname).toBe('ministar');
  });

  it('removePeer disconnects listener and clears persisted entry', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();
    const added = await bridge.addPeer({ url: 'ws://x/ws', apiKey: 'k' });
    expect(added.success).toBe(true);
    const peerId = added.peer!.id;
    await new Promise((r) => setImmediate(r));

    const result = await bridge.removePeer(peerId);
    expect(result.success).toBe(true);
    const list = await bridge.listPeers();
    expect(list).toHaveLength(0);

    const raw = await fs.readFile(
      path.join(tmpDir, 'fleet-peers.json'),
      'utf-8'
    );
    expect(JSON.parse(raw).peers).toHaveLength(0);
  });

  it('addPeer rejects without apiKey or jwt', async () => {
    const bridge = new FleetBridge(() => {});
    await bridge.init();
    const result = await bridge.addPeer({ url: 'ws://x/ws' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('apiKey');
  });
});
