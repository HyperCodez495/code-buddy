/**
 * FleetBridge — multi-host Code Buddy listener (GAP 3)
 *
 * Wraps the core `FleetListener` from `src/fleet/fleet-listener.ts` so
 * Cowork can subscribe to `fleet:*` events broadcast by remote Code Buddy
 * peers over the Tailscale mesh (e.g. Ministar Linux hub at
 * `ws://100.98.18.76:3000/ws`).
 *
 * Design choices
 * - Reuses the core listener via `loadCoreModule` rather than reimplementing
 *   the WS protocol (auth, reconnect, ring buffer, presence already handled).
 * - One `FleetListener` instance per peer, kept in a `Map<peerId, ...>`.
 * - Peer registry persisted to `<userData>/fleet-peers.json` (apiKey
 *   stored locally — V1 trade-off, harden with keytar later).
 * - Every event flows out as a Cowork `ServerEvent` via `sendToRenderer`.
 *
 * @module main/fleet/fleet-bridge
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { app } from 'electron';
import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type {
  ServerEvent,
  FleetPeer,
  FleetPeerStatus,
  FleetEventRecord,
} from '../../renderer/types';

type FleetCapability = NonNullable<FleetPeer['capability']>;
type FleetPeerChatProvider = NonNullable<FleetPeer['peerChatProvider']>;

interface CoreFleetListener {
  connect(): Promise<void>;
  disconnect(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ): Promise<unknown>;
}

interface CoreFleetListenerOptions {
  url: string;
  apiKey?: string;
  jwt?: string;
  autoReconnect?: boolean;
  historyCapacity?: number;
}

interface CoreFleetModule {
  FleetListener: new (options: CoreFleetListenerOptions) => CoreFleetListener;
}

interface PeerEntry {
  meta: FleetPeer;
  apiKey?: string;
  jwt?: string;
  listener: CoreFleetListener | null;
}

interface PersistedPeer {
  id: string;
  url: string;
  label?: string;
  addedAt: number;
  apiKey?: string;
  jwt?: string;
}

interface PersistedFile {
  peers: PersistedPeer[];
}

const EVENT_RING_CAPACITY = 200;
const CAPABILITY_REFRESH_INTERVAL_MS = 60_000;
const PEER_DESCRIBE_TIMEOUT_MS = 5_000;

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

let cachedModule: CoreFleetModule | null = null;
async function loadFleetModule(): Promise<CoreFleetModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<CoreFleetModule>('fleet/fleet-listener.js');
  if (mod) {
    cachedModule = mod;
    log('[FleetBridge] Core fleet-listener module loaded');
  } else {
    logWarn('[FleetBridge] Core fleet-listener module unavailable');
  }
  return mod;
}

export class FleetBridge {
  private readonly registryPath: string;
  private readonly sendToRenderer: (event: ServerEvent) => void;
  private peers: Map<string, PeerEntry> = new Map();
  private events: FleetEventRecord[] = [];
  private capabilityRefreshedAt: Map<string, number> = new Map();
  private loaded = false;

  constructor(sendToRenderer: (event: ServerEvent) => void) {
    this.sendToRenderer = sendToRenderer;
    const userData = app.isReady()
      ? app.getPath('userData')
      : path.join(os.homedir(), '.codebuddy-cowork');
    this.registryPath = path.join(userData, 'fleet-peers.json');
  }

  /** Load persisted peers and connect each one. Safe to call multiple times. */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedFile;
      for (const p of parsed.peers ?? []) {
        const meta: FleetPeer = {
          id: p.id,
          url: p.url,
          label: p.label,
          addedAt: p.addedAt,
          status: 'disconnected',
        };
        this.peers.set(p.id, {
          meta,
          apiKey: p.apiKey,
          jwt: p.jwt,
          listener: null,
        });
      }
      log(`[FleetBridge] Loaded ${this.peers.size} persisted peer(s)`);
    } catch {
      // First launch — no registry yet
    }
    // Best-effort connect all peers in parallel
    await Promise.all(
      Array.from(this.peers.keys()).map((id) =>
        this.connectPeer(id).catch((err) => logWarn(`[FleetBridge] connectPeer(${id}) failed:`, err))
      )
    );
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      const file: PersistedFile = {
        peers: Array.from(this.peers.values()).map((entry) => ({
          id: entry.meta.id,
          url: entry.meta.url,
          label: entry.meta.label,
          addedAt: entry.meta.addedAt,
          apiKey: entry.apiKey,
          jwt: entry.jwt,
        })),
      };
      await fs.writeFile(this.registryPath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logError('[FleetBridge] save failed:', err);
    }
  }

  private updateStatus(peerId: string, status: FleetPeerStatus, error?: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.meta.status = status;
    entry.meta.lastError = error;
    this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...entry.meta } } });
  }

  private emitPeerUpdate(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...entry.meta } } });
  }

  private async refreshPeerCapabilities(
    peerId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const entry = this.peers.get(peerId);
    if (!entry?.listener) return;
    const now = Date.now();
    const last = this.capabilityRefreshedAt.get(peerId) ?? 0;
    if (!options.force && now - last < CAPABILITY_REFRESH_INTERVAL_MS) return;

    try {
      const raw = (await entry.listener.request(
        'peer.describe',
        {},
        { timeoutMs: PEER_DESCRIBE_TIMEOUT_MS },
      )) as { capabilities?: unknown; peerChatProvider?: unknown };
      entry.meta.capability = normalizeCapability(raw.capabilities);
      entry.meta.peerChatProvider = normalizePeerChatProvider(raw.peerChatProvider);
      entry.meta.lastError = undefined;
      this.capabilityRefreshedAt.set(peerId, now);
      this.emitPeerUpdate(peerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.meta.lastError = `peer.describe failed: ${message}`;
      this.emitPeerUpdate(peerId);
      logWarn(`[FleetBridge] peer.describe failed for ${peerId}:`, message);
    }
  }

  private async refreshAllCapabilities(options: { force?: boolean } = {}): Promise<void> {
    await Promise.all(
      Array.from(this.peers.keys()).map((id) =>
        this.refreshPeerCapabilities(id, options).catch((err) =>
          logWarn(`[FleetBridge] refreshPeerCapabilities(${id}) failed:`, err),
        ),
      ),
    );
  }

  private async connectPeer(peerId: string): Promise<void> {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const mod = await loadFleetModule();
    if (!mod) {
      this.updateStatus(peerId, 'error', 'Fleet listener module unavailable');
      return;
    }
    if (entry.listener) {
      // Already connected/connecting; tear down before re-connecting
      try {
        await entry.listener.disconnect();
      } catch {
        /* ignore */
      }
      entry.listener = null;
    }

    const listener = new mod.FleetListener({
      url: entry.meta.url,
      apiKey: entry.apiKey,
      jwt: entry.jwt,
      autoReconnect: true,
      historyCapacity: 0, // we keep our own ring on the bridge level
    });
    entry.listener = listener;
    this.updateStatus(peerId, 'connecting');

    listener.on('connected', () => this.updateStatus(peerId, 'connected'));
    listener.on('authenticated', () => {
      this.updateStatus(peerId, 'authenticated');
      void this.refreshPeerCapabilities(peerId, { force: true });
    });
    listener.on('disconnected', () => this.updateStatus(peerId, 'disconnected'));
    listener.on('reconnecting', () => this.updateStatus(peerId, 'reconnecting'));
    listener.on('reconnected', () => {
      this.updateStatus(peerId, 'authenticated');
      void this.refreshPeerCapabilities(peerId, { force: true });
    });
    listener.on('error', (...args: unknown[]) => {
      const err = args[0];
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
      this.updateStatus(peerId, 'error', msg);
    });
    listener.on('fleet:event', (...args: unknown[]) => {
      const data = args[0] as { type?: string; payload?: Record<string, unknown> } | undefined;
      if (!data || typeof data.type !== 'string') return;
      const payload = data.payload ?? {};
      const source = payload.source as { hostname?: string; agentId?: string } | undefined;
      const record: FleetEventRecord = {
        peerId,
        type: data.type,
        payload,
        receivedAt: Date.now(),
        hostname: source?.hostname,
        agentId: source?.agentId,
      };
      this.events.push(record);
      while (this.events.length > EVENT_RING_CAPACITY) {
        this.events.shift();
      }
      const peerMeta = this.peers.get(peerId)?.meta;
      if (peerMeta) {
        peerMeta.lastSeenAt = record.receivedAt;
        peerMeta.lastEventType = record.type;
        this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...peerMeta } } });
      }
      this.sendToRenderer({ type: 'fleet.event', payload: record });
    });

    try {
      await listener.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus(peerId, 'error', msg);
      logWarn(`[FleetBridge] Initial connect failed for ${peerId}: ${msg}`);
      // Listener may have scheduled a reconnect via autoReconnect — leave it.
    }
  }

  async listPeers(): Promise<FleetPeer[]> {
    await this.refreshAllCapabilities();
    return Array.from(this.peers.values()).map((e) => ({ ...e.meta }));
  }

  async refreshCapabilities(peerId?: string): Promise<{
    success: boolean;
    peer?: FleetPeer;
    peers?: FleetPeer[];
    error?: string;
  }> {
    if (peerId) {
      if (!this.peers.has(peerId)) {
        return { success: false, error: `Unknown peer: ${peerId}` };
      }
      await this.refreshPeerCapabilities(peerId, { force: true });
      const entry = this.peers.get(peerId);
      return entry
        ? { success: true, peer: { ...entry.meta } }
        : { success: false, error: `Unknown peer: ${peerId}` };
    }

    await this.refreshAllCapabilities({ force: true });
    return {
      success: true,
      peers: Array.from(this.peers.values()).map((e) => ({ ...e.meta })),
    };
  }

  async addPeer(input: {
    url: string;
    apiKey?: string;
    jwt?: string;
    label?: string;
  }): Promise<{ success: boolean; peer?: FleetPeer; error?: string }> {
    if (!input.url) return { success: false, error: 'url required' };
    if (!input.apiKey && !input.jwt) {
      return { success: false, error: 'apiKey or jwt required' };
    }
    const id = sanitizeId(input.label || input.url);
    if (this.peers.has(id)) {
      return { success: false, error: `Peer ${id} already exists` };
    }
    const meta: FleetPeer = {
      id,
      url: input.url,
      label: input.label,
      addedAt: Date.now(),
      status: 'disconnected',
    };
    this.peers.set(id, {
      meta,
      apiKey: input.apiKey,
      jwt: input.jwt,
      listener: null,
    });
    await this.save();
    this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...meta } } });
    void this.connectPeer(id);
    return { success: true, peer: { ...meta } };
  }

  async removePeer(peerId: string): Promise<{ success: boolean }> {
    const entry = this.peers.get(peerId);
    if (!entry) return { success: false };
    if (entry.listener) {
      try {
        await entry.listener.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.peers.delete(peerId);
    this.capabilityRefreshedAt.delete(peerId);
    this.events = this.events.filter((e) => e.peerId !== peerId);
    await this.save();
    return { success: true };
  }

  async reconnectPeer(peerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.peers.has(peerId)) return { success: false, error: 'Peer not found' };
    try {
      await this.connectPeer(peerId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getRecentEvents(peerId?: string, limit = 100): Promise<FleetEventRecord[]> {
    const filtered = peerId ? this.events.filter((e) => e.peerId === peerId) : this.events;
    return filtered.slice(-limit);
  }

  /**
   * Wiring W1 — invoke a peer-rpc method on a connected peer.
   *
   * Throws if the peer is unknown or its listener is not yet
   * authenticated. Caller (saga-runner) is responsible for the retry
   * policy and step bookkeeping.
   */
  async peerRequest(
    peerId: string,
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<unknown> {
    const entry = this.peers.get(peerId);
    if (!entry) {
      throw new Error(`peer not found: ${peerId}`);
    }
    if (!entry.listener) {
      throw new Error(`peer ${peerId} has no active listener (status=${entry.meta.status})`);
    }
    return entry.listener.request(method, params, options);
  }

  async shutdown(): Promise<void> {
    for (const entry of this.peers.values()) {
      if (entry.listener) {
        try {
          await entry.listener.disconnect();
        } catch {
          /* ignore */
        }
        entry.listener = null;
      }
    }
  }
}

function normalizePeerChatProvider(raw: unknown): FleetPeerChatProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as {
    provider?: unknown;
    model?: unknown;
    isLocal?: unknown;
  };
  if (
    typeof candidate.provider !== 'string' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.isLocal !== 'boolean'
  ) {
    return null;
  }
  return {
    provider: candidate.provider,
    model: candidate.model,
    isLocal: candidate.isLocal,
  };
}

function normalizeCapability(raw: unknown): FleetCapability | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Partial<FleetCapability>;
  if (!Array.isArray(candidate.models)) return undefined;
  const models = candidate.models.filter((model): model is FleetCapability['models'][number] => (
    Boolean(model) &&
    typeof model.id === 'string' &&
    typeof model.contextWindow === 'number' &&
    Array.isArray(model.strengths) &&
    typeof model.provider === 'string'
  ));
  if (models.length === 0) return undefined;
  const egress = candidate.egress === 'lan' || candidate.egress === 'cloud'
    ? candidate.egress
    : 'local';
  return {
    egress,
    machineLabel: typeof candidate.machineLabel === 'string'
      ? candidate.machineLabel
      : '',
    machineSpec: candidate.machineSpec,
    maxConcurrency: candidate.maxConcurrency,
    activeRequests: candidate.activeRequests,
    models,
  };
}

let singleton: FleetBridge | null = null;

export function getFleetBridge(sendToRenderer?: (event: ServerEvent) => void): FleetBridge {
  if (!singleton) {
    if (!sendToRenderer) {
      throw new Error('FleetBridge requires sendToRenderer on first init');
    }
    singleton = new FleetBridge(sendToRenderer);
  }
  return singleton;
}
