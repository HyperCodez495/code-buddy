/**
 * Peer chat bridge (Phase (d).15 V0.4.1).
 *
 * Registers `peer.chat` on the peer-rpc registry: a remote peer can
 * call `peer.chat({ prompt, systemPrompt?, model? })` to ask THIS
 * peer's LLM a one-shot question. The handler mirrors the pattern of
 * the local `/btw` slash (src/commands/handlers/btw-handler.ts):
 *   - minimal system prompt
 *   - no tools
 *   - no history mutation
 *   - returns the assistant's text
 *
 * The CodeBuddyClient instance is provided lazily via a closure passed
 * to `wirePeerChatBridge(getClient)`. This decouples the bridge from
 * any singleton — the caller (server boot, test) decides where the
 * client comes from. If `getClient()` returns null, the handler throws
 * CLIENT_UNAVAILABLE so peers know this node can't currently respond.
 *
 * Idempotent (mirrors compaction-bridge): a second wire call is a no-op.
 */

import type { CodeBuddyClient, ChatOptions } from '../codebuddy/client.js';
import { registerPeerMethod, unregisterPeerMethod } from '../server/websocket/peer-rpc.js';
import { logger } from '../utils/logger.js';
import type { PeerChatProviderInfo } from './peer-chat-client-factory.js';

/** Closure that returns the CodeBuddyClient to use for peer.chat, or null if none is wired. */
export type PeerChatClientGetter = () => CodeBuddyClient | null;

let cachedGetter: PeerChatClientGetter | null = null;
let cachedProviderInfo: PeerChatProviderInfo | null = null;
let wired = false;

const DEFAULT_SYSTEM_PROMPT = 'Answer this side question briefly. Do not use tools.';

/**
 * Register the `peer.chat` method on the peer-rpc registry. The
 * `getClient` closure is captured and called on EACH invocation, so
 * the caller can swap clients dynamically (e.g. when reloading config)
 * without re-wiring.
 *
 * Idempotent — a second call is a no-op (does NOT replace the cached
 * getter; un-wire first if you need to swap).
 */
export function wirePeerChatBridge(
  getClient: PeerChatClientGetter,
  providerInfo?: PeerChatProviderInfo | null,
): void {
  if (wired) {
    logger.debug('[peer-chat-bridge] wire() called while already wired — no-op');
    return;
  }
  cachedGetter = getClient;
  cachedProviderInfo = providerInfo ?? null;
  registerPeerMethod('peer.chat', async (params, ctx) => {
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    const systemPrompt =
      typeof params.systemPrompt === 'string' && params.systemPrompt.length > 0
        ? params.systemPrompt
        : DEFAULT_SYSTEM_PROMPT;
    const model = typeof params.model === 'string' && params.model.length > 0
      ? params.model
      : undefined;

    if (!prompt) {
      // dispatchPeerRequest wraps thrown errors as METHOD_ERROR.
      throw new Error('peer.chat: prompt is required (string)');
    }
    const client = cachedGetter?.() ?? null;
    if (!client) {
      throw new Error(
        'CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat cannot answer)',
      );
    }

    const chatOptions: ChatOptions | undefined = model ? { model } : undefined;
    const response = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      undefined, // no tools
      chatOptions,
    );

    return {
      text: response?.choices?.[0]?.message?.content ?? '',
      // The CodeBuddyResponse shape doesn't expose the model name
      // directly (provider-specific). Echo what the caller asked for
      // so they can attribute the response correctly.
      modelRequested: model,
      finishReason: response?.choices?.[0]?.finish_reason,
      usage: response?.usage,
      // Echo traceId so consumers can correlate a peer.chat answer
      // back to its originating call chain (Phase (d).14 trace).
      traceId: ctx.traceId,
    };
  });
  wired = true;
  logger.debug('[peer-chat-bridge] wired');
}

/** Detach the peer.chat method. Idempotent. */
export function unwirePeerChatBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.chat');
  cachedGetter = null;
  cachedProviderInfo = null;
  wired = false;
  logger.debug('[peer-chat-bridge] unwired');
}

/**
 * Phase (d).16a — read the wired provider info (or null if peer.chat
 * isn't wired with a real client). Surfaced via peer.describe so remote
 * Claudes can discover what kind of LLM lives behind this peer.chat.
 */
export function getPeerChatProviderInfo(): PeerChatProviderInfo | null {
  return cachedProviderInfo;
}

/** Whether the bridge is currently registered on the peer-rpc registry. */
export function isPeerChatBridgeWired(): boolean {
  return wired;
}

/** Test-only reset hook. Force-unwire even if state is desync'd. */
export function _unwireForTests(): void {
  try {
    unregisterPeerMethod('peer.chat');
  } catch {
    /* peer-rpc may not be initialised in some test setups */
  }
  cachedGetter = null;
  cachedProviderInfo = null;
  wired = false;
}
