/**
 * Fleet listener slash command handler — `/fleet` (Phase (d).5 → (d).12 V0.4.1).
 *
 * Closes the inter-Claude streaming loop started in (d).1: connects to a
 * peer Code Buddy's Gateway WebSocket, subscribes to fleet:* events, and
 * prints them live to the chat. Authentication uses the existing apiKey
 * path; the key must have the `fleet:listen` scope.
 *
 * Sub-actions:
 *   /fleet listen <ws-url> [--api-key <key>] [--name <id>]
 *                  [--auto-reconnect [--max-attempts <n>]]
 *                                              Connect + start streaming.
 *                                              --name (Phase (d).12) gives
 *                                              the peer a stable id; default
 *                                              is derived from the WS host.
 *                                              --auto-reconnect (Phase (d).6)
 *                                              keeps the listener alive
 *                                              across ws drops with
 *                                              exponential-backoff retry.
 *   /fleet stop [name|--all]                    Disconnect a peer (or all).
 *                                              Defaults to the only active
 *                                              listener when there's one.
 *   /fleet status                               Show all connected peers.
 *   /fleet history [N] [--peer <name>]          Show last N fleet:* events
 *                                              from one peer (or the only
 *                                              one if not specified).
 *
 * Phase (d).12 — multi-peer fan-in: a single Claude can now hold N
 * simultaneous /fleet listen sessions to different peers, each with its
 * own auto-reconnect, presence beacon, compaction state and event ring.
 *
 * Honest scope cuts (V0.4.1):
 * - apiKey can come from --api-key flag or CODEBUDDY_FLEET_API_KEY env;
 *   no TOML wiring yet (the rest of the codebase reads server keys from
 *   env, so this matches).
 * - Routing actif (sending tasks to peers) is Phase (d).13.
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const HELP = `Usage: /fleet <action> [args]

Actions:
  listen <ws-url> [--api-key <key>]   Connect to a peer Code Buddy's WS
         [--name <id>]                and stream fleet:* events live.
         [--auto-reconnect]           Example: /fleet listen ws://100.98.18.76:3000/ws
         [--max-attempts <n>]         apiKey from --api-key flag or
                                      CODEBUDDY_FLEET_API_KEY env. Must
                                      have fleet:listen scope on the peer.
                                      --name (d).12 gives the peer a stable
                                      id; default derived from the WS host.
                                      --auto-reconnect (d).6 keeps the
                                      listener alive across ws drops.
                                      --max-attempts caps retry tries
                                      (default 5; with --auto-reconnect).
  stop [name|--all]                   Disconnect a peer (or all). Defaults
                                      to the only active listener when one.
  status                              Show all connected peers + their state.
  history [N] [--peer <name>]         Show last N fleet:* events from one
                                      peer (default 20, caps at ring size).
  send <peer> <method> [json-params]  (Phase (d).13) Invoke a peer RPC
            [--timeout <ms>]          method synchronously and print the
                                      response. Method names are dotted,
                                      e.g. "peer.describe" / "peer.ping" /
                                      "peer.echo". The peer's apiKey must
                                      have peer:invoke scope. Default
                                      timeout is 30000ms.

Phase (d).5 → (d).13 V0.4.1 — multi-peer fan-in, opt-in auto-reconnect,
presence beacon, compaction notices, in-memory event history, active peer
RPC routing.`;

interface ActiveListener {
  /** Phase (d).12 — stable peer id (the Map key). Used by /fleet stop & history. */
  id: string;
  url: string;
  startedAt: Date;
  eventCount: number;
  autoReconnect: boolean;
  /**
   * Tighter cap honored on /fleet listen than the manager default.
   * Stored so /fleet status can show "N/M attempts".
   */
  maxAttempts: number;
  /**
   * FleetListener instance kept as `unknown`-equivalent to avoid pulling
   * the ws import at handler-load time (matches lazy-import patterns).
   */
  listener: {
    disconnect: () => Promise<void>;
    getReconnectAttempts: () => number;
    isReconnecting: () => boolean;
    /** Phase (d).13 — peer RPC invoker. Returns method payload or rejects with code-bearing Error. */
    request: (
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number; traceId?: string; depth?: number },
    ) => Promise<unknown>;
    getLastSeen: () => { at: number | null; reason: string | null; ageMs: number | null };
    isStale: (thresholdMs?: number) => boolean;
    getPeerCompactionState: () => {
      active: boolean;
      startedAt: number | null;
      ageMs: number | null;
      lastResult: {
        success?: boolean;
        originalTokens?: number;
        compactedTokens?: number;
        messagesRemoved?: number;
        strategy?: string;
        durationMs?: number;
        completedAt: number;
      } | null;
    };
    getEventHistory: () => readonly {
      at: number;
      type: string;
      payload: Record<string, unknown>;
      hostname?: string;
      agentId?: string;
    }[];
  };
}

/** Default count rendered by `/fleet history` when no N supplied. */
const HISTORY_DEFAULT_COUNT = 20;

/** Stale threshold for /fleet status `⚠ stale` flag (Phase (d).9). */
const STALE_THRESHOLD_MS = 90_000;

/**
 * Phase (d).12 — registry of active peer listeners, keyed by peer id.
 * Replaces the V0.4.1 single-peer singleton.
 */
const activeListeners = new Map<string, ActiveListener>();

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

interface ParsedListenArgs {
  url: string | null;
  apiKey: string | null;
  name: string | null;
  autoReconnect: boolean;
  maxAttempts: number | null;
}

interface ParsedStopArgs {
  name: string | null;
  all: boolean;
}

interface ParsedHistoryArgs {
  count: number | null;
  peer: string | null;
}

/**
 * Phase (d).11 — format the time portion of a history line as HH:mm:ss.
 * Uses local timezone (matches the user's terminal display).
 */
function formatHistoryTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Phase (d).11 — render a one-line summary of a fleet event payload,
 * keyed off the event type. Goal: make /fleet history scannable at a
 * glance without forcing the reader to dig into the JSON.
 */
function summarizeHistoryPayload(
  type: string,
  payload: Record<string, unknown>,
): string {
  if (type === 'fleet:peer:heartbeat') return '(heartbeat)';
  if (type === 'fleet:peer:compacting:start') return '(compacting started)';
  if (type === 'fleet:peer:compacting:complete') {
    const strategy = typeof payload.strategy === 'string' ? payload.strategy : 'unknown';
    const dur = typeof payload.durationMs === 'number' ? `${payload.durationMs}ms` : 'n/a';
    return `(compacted: ${strategy} ${dur})`;
  }
  if (type.startsWith('fleet:agent:tool')) {
    const tool = typeof payload.toolName === 'string'
      ? payload.toolName
      : typeof payload.tool === 'string'
        ? payload.tool
        : 'unknown';
    return `tool=${tool}`;
  }
  if (type.startsWith('fleet:workflow:')) {
    const wid = typeof payload.workflowId === 'string' ? payload.workflowId : 'unknown';
    return `workflowId=${wid}`;
  }
  if (type.startsWith('fleet:session:')) {
    const child =
      typeof payload.childSessionId === 'string' ? payload.childSessionId :
      typeof payload.sessionId === 'string' ? payload.sessionId :
      'unknown';
    return `child=${child}`;
  }
  // Fallback: stringify and clip. Excludes the `source` key (already
  // rendered in the source column).
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k !== 'source') filtered[k] = v;
  }
  const json = JSON.stringify(filtered);
  return json.length > 60 ? json.slice(0, 57) + '...' : json;
}

/** Phase (d).11 — render the source column "[hostname:agentShort]" or "" when unknown. */
function formatHistorySource(record: { hostname?: string; agentId?: string }): string {
  if (!record.hostname && !record.agentId) return '';
  const host = record.hostname ?? '?';
  const agent = record.agentId ? `:${record.agentId.slice(0, 8)}` : '';
  return ` [${host}${agent}]`;
}

/**
 * Phase (d).12 — derive a default peer id from the WS URL (host:port).
 * `ws://100.98.18.76:3000/ws` → `100-98-18-76:3000` (dots → dashes for
 * easier shell typing in /fleet stop / --peer).
 */
function deriveDefaultPeerId(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/\./g, '-');
  } catch {
    return `peer-${Date.now()}`;
  }
}

function parseArgs(rest: string[]): ParsedListenArgs {
  let url: string | null = null;
  let apiKey: string | null = null;
  let name: string | null = null;
  let autoReconnect = false;
  let maxAttempts: number | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--api-key' && i + 1 < rest.length) {
      apiKey = rest[i + 1];
      i++;
    } else if (arg === '--name' && i + 1 < rest.length) {
      name = rest[i + 1];
      i++;
    } else if (arg === '--auto-reconnect') {
      autoReconnect = true;
    } else if (arg === '--max-attempts' && i + 1 < rest.length) {
      const n = parseInt(rest[i + 1], 10);
      if (Number.isFinite(n) && n > 0) maxAttempts = n;
      i++;
    } else if (!url && (arg.startsWith('ws://') || arg.startsWith('wss://'))) {
      url = arg;
    }
  }
  return { url, apiKey, name, autoReconnect, maxAttempts };
}

function parseStopArgs(rest: string[]): ParsedStopArgs {
  let name: string | null = null;
  let all = false;
  for (const arg of rest) {
    if (arg === '--all') all = true;
    else if (!name && !arg.startsWith('--')) name = arg;
  }
  return { name, all };
}

function parseHistoryArgs(rest: string[]): ParsedHistoryArgs {
  let count: number | null = null;
  let peer: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--peer' && i + 1 < rest.length) {
      peer = rest[i + 1];
      i++;
    } else if (count === null && !arg.startsWith('--')) {
      const n = parseInt(arg, 10);
      if (Number.isFinite(n) && n > 0) count = n;
    }
  }
  return { count, peer };
}

/**
 * Phase (d).12 — render one peer block for /fleet status.
 * Reused logic from the V0.4.1 single-peer status; output now stacks
 * one block per active peer.
 */
function formatPeerStatus(p: ActiveListener): string {
  const elapsed = Math.round((Date.now() - p.startedAt.getTime()) / 1000);
  const lines: string[] = [];
  lines.push(`Peer "${p.id}"`);
  lines.push(`  URL:     ${p.url}`);
  lines.push(`  Uptime:  ${elapsed}s`);
  lines.push(`  Events:  ${p.eventCount} received`);
  if (p.autoReconnect) {
    const attempts = p.listener.getReconnectAttempts();
    const pending = p.listener.isReconnecting();
    lines.push(
      `  Reconnect: enabled (${attempts}/${p.maxAttempts} attempts since last connect` +
        `${pending ? ', retry pending' : ''})`,
    );
  } else {
    lines.push('  Reconnect: disabled');
  }
  // Presence
  const seen = p.listener.getLastSeen();
  if (seen.at === null) {
    lines.push('  Last seen: never (no events received yet)');
  } else {
    const ageSec = Math.round((seen.ageMs ?? 0) / 1000);
    const reason = seen.reason ?? 'unknown';
    const stale = p.listener.isStale(STALE_THRESHOLD_MS);
    const prefix = stale ? `  ⚠ stale (>${STALE_THRESHOLD_MS / 1000}s) — ` : '  ';
    lines.push(`${prefix}Last seen: ${ageSec}s ago (${reason})`);
  }
  // Compaction
  const compactionState = p.listener.getPeerCompactionState();
  if (compactionState.active) {
    const ageSec = Math.round((compactionState.ageMs ?? 0) / 1000);
    lines.push(`  ⏸ Peer compacting (started ${ageSec}s ago, in progress)`);
  } else if (compactionState.lastResult) {
    const r = compactionState.lastResult;
    const saved =
      typeof r.originalTokens === 'number' && typeof r.compactedTokens === 'number'
        ? r.originalTokens - r.compactedTokens
        : null;
    const strategyTxt = r.strategy ?? 'unknown';
    const durTxt = typeof r.durationMs === 'number' ? `${r.durationMs}ms` : 'n/a';
    const savedTxt = saved !== null ? ` (saved ${saved} tokens)` : '';
    lines.push(`  Last compaction: ${strategyTxt} in ${durTxt}${savedTxt}`);
  }
  return lines.join('\n');
}

/**
 * Phase (d).12 — pick a default peer when /fleet stop / history is given
 * without a name and there's exactly one listener active. Returns null
 * when 0 or >1 listeners (caller must error / require name).
 */
function pickDefaultPeer(): ActiveListener | null {
  if (activeListeners.size !== 1) return null;
  return activeListeners.values().next().value ?? null;
}

export async function handleFleet(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (action === 'help' || action === '') {
    return textResult(HELP);
  }

  if (action === 'status') {
    if (activeListeners.size === 0) {
      return textResult('No fleet listeners active.\n\n' + HELP);
    }
    const blocks: string[] = [];
    blocks.push(`Fleet listeners — ${activeListeners.size} active`);
    blocks.push('');
    for (const peer of activeListeners.values()) {
      blocks.push(formatPeerStatus(peer));
      blocks.push('');
    }
    blocks.push('Stop a peer with /fleet stop <name>, or all with /fleet stop --all.');
    return textResult(blocks.join('\n'));
  }

  if (action === 'stop') {
    if (activeListeners.size === 0) {
      return textResult('No fleet listeners active to stop.');
    }
    const { name, all } = parseStopArgs(rest);
    if (all) {
      const stopped: string[] = [];
      for (const peer of [...activeListeners.values()]) {
        try {
          await peer.listener.disconnect();
        } catch (err) {
          logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
        }
        activeListeners.delete(peer.id);
        stopped.push(`${peer.id} (${peer.eventCount} event(s))`);
      }
      return textResult(`Fleet stopped ${stopped.length} listener(s): ${stopped.join(', ')}`);
    }
    let target: ActiveListener | null = null;
    if (name) {
      target = activeListeners.get(name) ?? null;
      if (!target) {
        return textResult(
          `No fleet peer named "${name}". Active peers: ${[...activeListeners.keys()].join(', ')}`,
        );
      }
    } else {
      target = pickDefaultPeer();
      if (!target) {
        return textResult(
          `Multiple fleet listeners active (${activeListeners.size}). ` +
            `Specify a peer name or use --all. Active: ${[...activeListeners.keys()].join(', ')}`,
        );
      }
    }
    const url = target.url;
    const count = target.eventCount;
    const id = target.id;
    try {
      await target.listener.disconnect();
    } catch (err) {
      logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
    }
    activeListeners.delete(id);
    return textResult(`Fleet listener "${id}" stopped. URL: ${url}\nReceived ${count} event(s) total.`);
  }

  if (action === 'listen') {
    const { url, apiKey: cliKey, name: explicitName, autoReconnect, maxAttempts } = parseArgs(rest);
    if (!url) {
      return textResult(
        'Usage: /fleet listen <ws-url> [--api-key <key>] [--name <id>] [--auto-reconnect] [--max-attempts <n>]\n\n' + HELP,
      );
    }
    const apiKey = cliKey ?? process.env.CODEBUDDY_FLEET_API_KEY;
    if (!apiKey) {
      return textResult(
        'Error: no apiKey provided.\n' +
          'Pass --api-key <key> or set CODEBUDDY_FLEET_API_KEY env.\n' +
          'Key must have fleet:listen scope on the peer.',
      );
    }

    const peerId = explicitName ?? deriveDefaultPeerId(url);
    if (activeListeners.has(peerId)) {
      return textResult(
        `Fleet peer "${peerId}" is already active for ${activeListeners.get(peerId)!.url}. ` +
          `Stop it first with /fleet stop ${peerId}, then re-issue /fleet listen, ` +
          `or pick a different --name.`,
      );
    }

    try {
      const { FleetListener } = await import('../../fleet/fleet-listener.js');
      const cap = maxAttempts ?? 5;
      const listener = new FleetListener({
        url,
        apiKey,
        autoReconnect,
        reconnect: autoReconnect ? { maxRetries: cap } : undefined,
      });
      const startedAt = new Date();

      // Phase (d).12 — wire stdout streaming with the peer id in the prefix
      // so multi-peer output stays distinguishable when interleaved.
      listener.on('fleet:event', (data: { type: string; payload: Record<string, unknown> }) => {
        const peer = activeListeners.get(peerId);
        if (peer) peer.eventCount++;
        const source = data.payload?.source as { hostname?: string; agentId?: string } | undefined;
        const hostInfo = source ? ` [${source.hostname}${source.agentId ? `:${source.agentId.slice(0, 8)}` : ''}]` : '';
        process.stdout.write(`  [fleet:${peerId}${hostInfo}] ${data.type}\n`);
      });

      listener.on('disconnected', () => {
        process.stdout.write(`  [fleet:${peerId}] disconnected from ${url}\n`);
        // Without auto-reconnect, the disconnected event marks the end of
        // the session — clear the registry entry. With auto-reconnect,
        // disconnected starts a retry cycle, so we keep the entry.
        if (!autoReconnect) {
          activeListeners.delete(peerId);
        }
      });

      listener.on('error', (err: Error) => {
        process.stdout.write(`  [fleet:${peerId}] error: ${err.message}\n`);
      });

      if (autoReconnect) {
        listener.on('reconnecting', (data: { attempt: number; delayMs: number }) => {
          process.stdout.write(
            `  [fleet:${peerId}] reconnect attempt ${data.attempt}/${cap} in ${data.delayMs}ms\n`,
          );
        });
        listener.on('reconnected', (data: { attempt: number }) => {
          process.stdout.write(`  [fleet:${peerId}] reconnected after ${data.attempt} attempt(s)\n`);
        });
        listener.on('exhausted', (data: { totalAttempts: number }) => {
          process.stdout.write(
            `  [fleet:${peerId}] reconnect exhausted after ${data.totalAttempts} attempt(s) — listener stopped\n`,
          );
          activeListeners.delete(peerId);
        });
      }

      await listener.connect();
      activeListeners.set(peerId, {
        id: peerId,
        url,
        startedAt,
        eventCount: 0,
        autoReconnect,
        maxAttempts: cap,
        listener,
      });
      logger.info('Fleet listener started', { id: peerId, url, autoReconnect });
      const reconnectNote = autoReconnect
        ? ` Auto-reconnect enabled (max ${cap} attempts).`
        : '';
      return textResult(
        `Fleet peer "${peerId}" connected to ${url}.\n` +
          `Streaming fleet:* events live.${reconnectNote} ` +
          `Stop with /fleet stop ${peerId}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Fleet listener connect failed: ${msg}`);
    }
  }

  if (action === 'history') {
    if (activeListeners.size === 0) {
      return textResult('No fleet listeners active.\n\n' + HELP);
    }
    const { count, peer: peerName } = parseHistoryArgs(rest);
    const n = count ?? HISTORY_DEFAULT_COUNT;

    let target: ActiveListener | null = null;
    if (peerName) {
      target = activeListeners.get(peerName) ?? null;
      if (!target) {
        return textResult(
          `No fleet peer named "${peerName}". Active peers: ${[...activeListeners.keys()].join(', ')}`,
        );
      }
    } else {
      target = pickDefaultPeer();
      if (!target) {
        return textResult(
          `Multiple fleet listeners active (${activeListeners.size}). ` +
            `Specify --peer <name>. Active: ${[...activeListeners.keys()].join(', ')}`,
        );
      }
    }

    const history = target.listener.getEventHistory();
    if (history.length === 0) {
      return textResult(`No fleet events recorded yet for "${target.id}".`);
    }
    const slice = history.slice(Math.max(0, history.length - n));
    const lines: string[] = [];
    lines.push(`Fleet event history for "${target.id}" — last ${slice.length} of ${history.length}`);
    for (const rec of slice) {
      lines.push(
        `  [${formatHistoryTime(rec.at)}] ${rec.type}${formatHistorySource(rec)} ${summarizeHistoryPayload(rec.type, rec.payload)}`,
      );
    }
    return textResult(lines.join('\n'));
  }

  if (action === 'send') {
    if (activeListeners.size === 0) {
      return textResult('No fleet listeners active. Connect with /fleet listen first.');
    }
    // Parse: send <peer> <method> [json-params] [--timeout <ms>]
    let peerName: string | null = null;
    let method: string | null = null;
    let jsonParams: string | null = null;
    let timeoutMs = 30_000;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--timeout' && i + 1 < rest.length) {
        const n = parseInt(rest[i + 1], 10);
        if (Number.isFinite(n) && n > 0) timeoutMs = n;
        i++;
      } else if (!peerName) {
        peerName = arg;
      } else if (!method) {
        method = arg;
      } else if (!jsonParams) {
        // Take everything from here until --timeout as the params blob,
        // re-joining with spaces. Lets users paste un-quoted JSON.
        const remaining = rest.slice(i);
        const tIdx = remaining.indexOf('--timeout');
        const blobEnd = tIdx === -1 ? remaining.length : tIdx;
        jsonParams = remaining.slice(0, blobEnd).join(' ');
        i += blobEnd - 1;
      }
    }
    if (!peerName || !method) {
      return textResult(
        'Usage: /fleet send <peer> <method> [json-params] [--timeout <ms>]\n\n' + HELP,
      );
    }
    const target = activeListeners.get(peerName);
    if (!target) {
      return textResult(
        `No fleet peer named "${peerName}". Active peers: ${[...activeListeners.keys()].join(', ')}`,
      );
    }
    let params: Record<string, unknown> = {};
    if (jsonParams) {
      try {
        const parsed = JSON.parse(jsonParams);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return textResult('Error: params must be a JSON object (e.g. {"key":"value"}).');
        }
        params = parsed as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`Error: invalid JSON params: ${msg}`);
      }
    }
    try {
      const t0 = Date.now();
      const result = await target.listener.request(method, params, { timeoutMs });
      const elapsed = Date.now() - t0;
      const formatted = JSON.stringify(result, null, 2);
      return textResult(
        `Peer "${peerName}" → ${method} OK (${elapsed}ms):\n${formatted}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Peer "${peerName}" → ${method} FAILED:\n  ${message}`);
    }
  }

  return textResult(`Unknown fleet action: ${args[0]}\n\n${HELP}`);
}

/** Test reset hook. Stops all listeners and clears the registry. */
export function _resetFleetHandlerForTests(): void {
  for (const peer of activeListeners.values()) {
    peer.listener.disconnect().catch(() => { /* ignore */ });
  }
  activeListeners.clear();
}
