/**
 * `buddy acp` — run Code Buddy as an ACP (Agent Client Protocol) agent over
 * stdio, so editors like Zed can spawn it as an agent subprocess.
 *
 * Zed config example (`~/.config/zed/settings.json`):
 *   "agent_servers": {
 *     "Code Buddy": { "command": "buddy", "args": ["acp"] }
 *   }
 *
 * stdout is reserved for the newline-delimited JSON-RPC protocol channel; all
 * logging goes to stderr (the logger already writes via console.error, and we
 * drop its level to `error` here as belt-and-suspenders).
 */

import type { Command } from 'commander';
import {
  AcpStdioServer,
  type AcpPromptRunner,
  type AcpContentBlock,
} from '../../protocols/acp/acp-stdio-server.js';

function extractPromptText(prompt: AcpContentBlock[]): string {
  return prompt
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

export function registerAcpCommand(program: Command): void {
  program
    .command('acp')
    .description('Run Code Buddy as an ACP (Agent Client Protocol) agent over stdio for editor integration (e.g. Zed)')
    .action(async () => {
      const { logger } = await import('../../utils/logger.js');
      logger.setLevel('error'); // keep stdout clean for the protocol channel

      const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');
      const { CodeBuddyClient } = await import('../../codebuddy/client.js');

      const detected = detectProviderFromEnv();
      const client = detected
        ? new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL)
        : null;

      const promptRunner: AcpPromptRunner = async ({ prompt, sendUpdate, signal }) => {
        const text = extractPromptText(prompt);
        if (!client) {
          sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'No LLM provider is configured. Set a provider key (e.g. GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY) or run `buddy login`.',
            },
          });
          return { stopReason: 'refusal' };
        }
        if (!text) {
          return { stopReason: 'end_turn' };
        }

        try {
          const response = await client.chat([
            {
              role: 'system',
              content:
                'You are Code Buddy, a coding assistant operating over the Agent Client Protocol inside a code editor. Answer concisely in Markdown.',
            },
            { role: 'user', content: text },
          ]);
          if (signal.aborted) return { stopReason: 'cancelled' };

          const choices = (response as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices;
          const answer = choices?.[0]?.message?.content ?? '';
          sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: answer || '(no response)' },
          });
          return { stopReason: 'end_turn' };
        } catch (err) {
          if (signal.aborted) return { stopReason: 'cancelled' };
          sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          });
          return { stopReason: 'refusal' };
        }
      };

      const server = new AcpStdioServer({ promptRunner });
      server.start();

      // Stay alive on stdin until the editor closes the pipe.
      process.stdin.on('end', () => process.exit(0));
      process.stdin.on('close', () => process.exit(0));
    });
}
