import { Command } from 'commander';
import { TunnelManager } from '../server/tunnel-manager.js';
import { logger } from '../utils/logger.js';

export function createTunnelCommand(): Command {
  const cmd = new Command('tunnel')
    .description('Manage ngrok tunnels for the Code Buddy remote gateway');

  cmd.command('start')
    .description('Start an ngrok tunnel')
    .option('-p, --port <number>', 'Port to tunnel to', '3000')
    .option('--domain <string>', 'Custom ngrok domain')
    .option('--authtoken <string>', 'ngrok authtoken (or set NGROK_AUTHTOKEN env var)')
    .option('--server', 'Start the local HTTP server along with the tunnel')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      
      if (opts.server) {
        // dynamically import server to start it
        try {
          const { startServer } = await import('../server/index.js');
          await startServer({ port });
          logger.info(`Local server started on port ${port}`);
        } catch (error) {
          logger.error('Failed to start local server', { error });
          process.exit(1);
        }
      }

      try {
        const url = await TunnelManager.startTunnel({
          port,
          domain: opts.domain,
          authtoken: opts.authtoken,
        });
        
        console.log(`\nTunnel started successfully!`);
        console.log(`Forwarding: ${url} -> http://localhost:${port}\n`);
        
        // Keep process alive if just tunneling
        process.on('SIGINT', async () => {
          await TunnelManager.stopTunnel();
          process.exit(0);
        });
      } catch (error) {
        console.error('Failed to start tunnel:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return cmd;
}
