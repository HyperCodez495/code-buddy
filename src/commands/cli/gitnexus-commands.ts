/**
 * CodeExplorer CLI commands
 *
 * Exposes commands to consult CodeExplorer and push session summaries.
 */

import type { Command } from 'commander';
import { CodeExplorerTool } from '../../tools/gitnexus-tool.js';

export function registerCodeExplorerCommands(program: Command): void {
  const gitnexus = program
    .command('gitnexus')
    .description('Interact with CodeExplorer for code understanding and session syncing');

  gitnexus
    .command('ask')
    .description('Consult CodeExplorer for a query or code understanding request')
    .argument('<query>', 'The query or task description to ask CodeExplorer about')
    .action(async (query: string) => {
      try {
        const gitNexus = new CodeExplorerTool();
        const result = await gitNexus.ask(query);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error querying CodeExplorer:', error);
        process.exit(1);
      }
    });

  gitnexus
    .command('push-session')
    .description('Push the session summary to CodeExplorer as technical memory')
    .argument('<summary>', 'The session summary to push')
    .action(async (summary: string) => {
      try {
        const gitNexus = new CodeExplorerTool();
        const result = await gitNexus.pushSession(summary);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error pushing session to CodeExplorer:', error);
        process.exit(1);
      }
    });
}
