/**
 * Fleet listener slash command handler — `/fleet` (Phase (d).5 V0.4.1).
 *
 * Closes the inter-Claude streaming loop started in (d).1: connects to a
 * peer Code Buddy's Gateway WebSocket, subscribes to fleet:* events, and
 * prints them live to the chat. Authentication uses the existing apiKey
 * path; the key must have the `fleet:listen` scope.
 *
 * Sub-actions:
 *   /fleet listen <ws-url> [--api-key <key>]   Connect + start streaming
 *   /fleet stop                                 Disconnect
 *   /fleet status                               Show connection state
 *
 * Honest scope cuts (V0.4.1):
 * - Only ONE listener at a time (singleton). Multiple peer connections
 *   would need a fleet of fleets, V0.5+ if needed.
 * - No auto-reconnect — if the peer drops, user must /fleet listen again.
 * - apiKey can come from --api-key flag or CODEBUDDY_FLEET_API_KEY env;
 *   no TOML wiring yet (the rest of the codebase reads server keys from
 *   env, so this matches).
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const HELP = `Usage: /fleet <action> [args]

Actions:
  listen <ws-url> [--api-key <key>]   Connect to a peer Code Buddy's WS
                                      and stream fleet:* events live.
                                      Example: /fleet listen ws://100.98.18.76:3000/ws
                                      apiKey from --api-key flag or
                                      CODEBUDDY_FLEET_API_KEY env. Must
                                      have fleet:listen scope on the peer.
  stop                                Disconnect the active listener.
  status                              Show whether a listener is active.

Phase (d).5 V0.4.1 — single listener at a time, no auto-reconnect.`;

interface ActiveListener {
  url: string;
  startedAt: Date;
  eventCount: number;
  // FleetListener instance kept as `unknown` so this module doesn't pull
  // in the ws import at handler-load time (matches lazy-import patterns).
  listener: { disconnect: () => Promise<void> };
}

let activeListener: ActiveListener | null = null;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

function parseArgs(rest: string[]): { url: string | null; apiKey: string | null } {
  let url: string | null = null;
  let apiKey: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--api-key' && i + 1 < rest.length) {
      apiKey = rest[i + 1];
      i++;
    } else if (!url && (arg.startsWith('ws://') || arg.startsWith('wss://'))) {
      url = arg;
    }
  }
  return { url, apiKey };
}

export async function handleFleet(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (action === 'help' || action === '') {
    return textResult(HELP);
  }

  if (action === 'status') {
    if (!activeListener) {
      return textResult('No fleet listener active.\n\n' + HELP);
    }
    const elapsed = Math.round((Date.now() - activeListener.startedAt.getTime()) / 1000);
    return textResult(
      `Fleet listener ACTIVE\n` +
        `  URL:     ${activeListener.url}\n` +
        `  Uptime:  ${elapsed}s\n` +
        `  Events:  ${activeListener.eventCount} received\n` +
        `\nStop with /fleet stop.`,
    );
  }

  if (action === 'stop') {
    if (!activeListener) {
      return textResult('No fleet listener active to stop.');
    }
    const url = activeListener.url;
    const count = activeListener.eventCount;
    try {
      await activeListener.listener.disconnect();
    } catch (err) {
      logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
    }
    activeListener = null;
    return textResult(`Fleet listener stopped. URL: ${url}\nReceived ${count} event(s) total.`);
  }

  if (action === 'listen') {
    if (activeListener) {
      return textResult(
        `Fleet listener already active for ${activeListener.url}.\n` +
          `Stop it first with /fleet stop, then re-issue /fleet listen.`,
      );
    }

    const { url, apiKey: cliKey } = parseArgs(rest);
    if (!url) {
      return textResult('Usage: /fleet listen <ws-url> [--api-key <key>]\n\n' + HELP);
    }
    const apiKey = cliKey ?? process.env.CODEBUDDY_FLEET_API_KEY;
    if (!apiKey) {
      return textResult(
        'Error: no apiKey provided.\n' +
          'Pass --api-key <key> or set CODEBUDDY_FLEET_API_KEY env.\n' +
          'Key must have fleet:listen scope on the peer.',
      );
    }

    try {
      const { FleetListener } = await import('../../fleet/fleet-listener.js');
      const listener = new FleetListener({ url, apiKey });
      const startedAt = new Date();
      let eventCount = 0;

      listener.on('fleet:event', (data: { type: string; payload: Record<string, unknown> }) => {
        eventCount++;
        if (activeListener) activeListener.eventCount = eventCount;
        const source = (data.payload?.source as { hostname?: string; agentId?: string } | undefined);
        const hostInfo = source ? ` [${source.hostname}${source.agentId ? `:${source.agentId.slice(0, 8)}` : ''}]` : '';
        // Direct stdout write for live streaming (same pattern as /agents).
        process.stdout.write(`  [fleet${hostInfo}] ${data.type}\n`);
      });

      listener.on('disconnected', () => {
        process.stdout.write(`  [fleet] disconnected from ${url}\n`);
        activeListener = null;
      });

      listener.on('error', (err: Error) => {
        process.stdout.write(`  [fleet] error: ${err.message}\n`);
      });

      await listener.connect();
      activeListener = { url, startedAt, eventCount: 0, listener };
      logger.info('Fleet listener started', { url });
      return textResult(
        `Fleet listener connected to ${url}.\n` +
          `Streaming fleet:* events live. Stop with /fleet stop.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Fleet listener connect failed: ${msg}`);
    }
  }

  return textResult(`Unknown fleet action: ${args[0]}\n\n${HELP}`);
}

/** Test reset hook. */
export function _resetFleetHandlerForTests(): void {
  if (activeListener) {
    activeListener.listener.disconnect().catch(() => { /* ignore */ });
  }
  activeListener = null;
}
