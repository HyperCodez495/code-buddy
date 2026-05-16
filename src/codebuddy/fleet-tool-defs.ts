/**
 * OpenAI function definitions for fleet tools — Phase (d).17.
 *
 * Used by the legacy `ToolRegistry` consumed in `src/codebuddy/tools.ts`.
 * The FormalToolRegistry path consumes the ITool adapters in
 * `src/tools/registry/fleet-tools.ts` instead. We keep both in lock-step
 * because some call sites pull from one registry and some from the other.
 */

import type { CodeBuddyTool } from './client.js';

export const PEER_DELEGATE_TOOL_DEF: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'peer_delegate',
    description:
      'Delegate a one-shot question or task to a connected fleet peer Code Buddy. ' +
      'The peer answers independently with its own model and returns its response. ' +
      'Use list_peers first to see which peers are available.',
    parameters: {
      type: 'object',
      properties: {
        peer: {
          type: 'string',
          description:
            'The peer ID (from /fleet listen --name). Use list_peers to discover available peer IDs.',
        },
        prompt: {
          type: 'string',
          description:
            'The question or task to ask the peer. Be specific and self-contained — the peer has no shared context.',
        },
        systemPrompt: {
          type: 'string',
          description:
            "Optional system prompt override for the peer. Defaults to the peer's brief-answer mode.",
        },
        model: {
          type: 'string',
          description:
            'Optional model hint for the peer (e.g. "grok-3", "claude-opus-4-5"). Peer may ignore.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Request timeout in milliseconds. Default 60000.',
        },
      },
      required: ['peer', 'prompt'],
    },
  },
};

export const LIST_PEERS_TOOL_DEF: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'list_peers',
    description:
      'List all connected fleet peers with their status (last seen, compacting, ' +
      'peer chat availability). Use this before peer_delegate to discover peer IDs. ' +
      'Set includeCapabilities=true when choosing between providers/models.',
    parameters: {
      type: 'object',
      properties: {
        includeCapabilities: {
          type: 'boolean',
          description:
            'When true, call peer.describe on each peer and include provider/model capability summaries. Requires peer:invoke.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Per-peer peer.describe timeout in milliseconds when includeCapabilities is true. Default 5000.',
        },
      },
      required: [],
    },
  },
};

export const FLEET_TOOLS: CodeBuddyTool[] = [PEER_DELEGATE_TOOL_DEF, LIST_PEERS_TOOL_DEF];
