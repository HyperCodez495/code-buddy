/**
 * MCP Resources - Read-only project context exposed via URI scheme
 *
 * Resources (codebuddy:// URI scheme):
 * - codebuddy://project/context   - Project context files + git status
 * - codebuddy://project/instructions - CODEBUDDY.md / CLAUDE.md custom instructions
 * - codebuddy://sessions/latest   - Latest session data as JSON
 * - codebuddy://memory/all        - All stored memories formatted as markdown
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register read-only resources with the MCP server.
 */
export function registerResources(server: McpServer): void {
  // codebuddy://project/context
  server.resource(
    'project_context',
    'codebuddy://project/context',
    {
      description: 'Project context files (CODEBUDDY.md, .codebuddy/config, etc.) and git status',
      mimeType: 'text/markdown',
    },
    async () => {
      try {
        const { loadContext, formatContextForPrompt } = await import('../context/context-files.js');
        const context = await loadContext(process.cwd());
        let text = formatContextForPrompt(context);

        // Append git status
        try {
          const { execSync } = await import('child_process');
          const gitStatus = execSync('git status --short 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
          if (gitStatus.trim()) {
            text += `\n\n## Git Status\n\`\`\`\n${gitStatus.trim()}\n\`\`\``;
          }
        } catch {
          // Not a git repo or git not available
        }

        return {
          contents: [{
            uri: 'codebuddy://project/context',
            mimeType: 'text/markdown',
            text,
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [{
            uri: 'codebuddy://project/context',
            mimeType: 'text/plain',
            text: `Error loading project context: ${message}`,
          }],
        };
      }
    }
  );

  // codebuddy://project/instructions
  server.resource(
    'project_instructions',
    'codebuddy://project/instructions',
    {
      description: 'Custom project instructions from CODEBUDDY.md, CLAUDE.md, or .codebuddy/instructions',
      mimeType: 'text/markdown',
    },
    async () => {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const cwd = process.cwd();

        const instructionFiles = [
          'CODEBUDDY.md',
          'CLAUDE.md',
          '.codebuddy/instructions.md',
          '.github/copilot-instructions.md',
        ];

        const parts: string[] = [];
        for (const file of instructionFiles) {
          const fullPath = path.join(cwd, file);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            parts.push(`## ${file}\n\n${content}`);
          } catch {
            // File doesn't exist, skip
          }
        }

        const text = parts.length > 0
          ? parts.join('\n\n---\n\n')
          : 'No custom instruction files found in this project.';

        return {
          contents: [{
            uri: 'codebuddy://project/instructions',
            mimeType: 'text/markdown',
            text,
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [{
            uri: 'codebuddy://project/instructions',
            mimeType: 'text/plain',
            text: `Error loading instructions: ${message}`,
          }],
        };
      }
    }
  );

  // codebuddy://sessions/latest
  server.resource(
    'sessions_latest',
    'codebuddy://sessions/latest',
    {
      description: 'Latest Code Buddy session data including messages and metadata',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const { getSessionStore } = await import('../persistence/session-store.js');
        const store = getSessionStore();
        const sessions = await store.getRecentSessions(1);

        if (sessions.length === 0) {
          return {
            contents: [{
              uri: 'codebuddy://sessions/latest',
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'No sessions found' }),
            }],
          };
        }

        const session = sessions[0];
        if (session === undefined) {
          return {
            contents: [{
              uri: 'codebuddy://sessions/latest',
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'No sessions found' }),
            }],
          };
        }
        const data = {
          id: session.id,
          name: session.name,
          model: session.model,
          workingDirectory: session.workingDirectory,
          messageCount: session.messages?.length ?? 0,
          createdAt: session.createdAt,
          lastAccessedAt: session.lastAccessedAt,
          recentMessages: (session.messages || []).slice(-10).map(m => ({
            type: m.type,
            content: m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content,
            timestamp: m.timestamp,
          })),
        };

        return {
          contents: [{
            uri: 'codebuddy://sessions/latest',
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [{
            uri: 'codebuddy://sessions/latest',
            mimeType: 'application/json',
            text: JSON.stringify({ error: message }),
          }],
        };
      }
    }
  );

  // codebuddy://memory/all
  server.resource(
    'memory_all',
    'codebuddy://memory/all',
    {
      description: 'All stored Code Buddy memories formatted as markdown',
      mimeType: 'text/markdown',
    },
    async () => {
      try {
        const { getMemoryManager } = await import('../memory/persistent-memory.js');
        const manager = getMemoryManager();
        await manager.initialize();
        const text = manager.formatMemories() || 'No memories stored.';

        return {
          contents: [{
            uri: 'codebuddy://memory/all',
            mimeType: 'text/markdown',
            text,
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [{
            uri: 'codebuddy://memory/all',
            mimeType: 'text/plain',
            text: `Error loading memories: ${message}`,
          }],
        };
      }
    }
  );
}
