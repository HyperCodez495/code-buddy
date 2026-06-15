import * as ngrok from '@ngrok/ngrok';
import { logger } from '../utils/logger.js';

export interface TunnelOptions {
  port: number;
  authtoken?: string;
  domain?: string;
}

export class TunnelManager {
  private static listener: ngrok.Listener | null = null;

  /**
   * Start an ngrok tunnel forwarding to the specified port.
   */
  static async startTunnel(options: TunnelOptions): Promise<string> {
    if (this.listener) {
      logger.warn('A tunnel is already running. Disconnecting existing tunnel.');
      await this.stopTunnel();
    }

    try {
      logger.info(`Starting ngrok tunnel for port ${options.port}...`);
      
      const ngrokOptions: any = {
        addr: options.port,
        authtoken_from_env: true,
      };

      if (options.authtoken) {
        ngrokOptions.authtoken = options.authtoken;
      }
      if (options.domain) {
        ngrokOptions.domain = options.domain;
      }

      this.listener = await ngrok.forward(ngrokOptions);
      const url = this.listener.url() ?? '';
      logger.info(`ngrok tunnel established at: ${url}`);
      return url;
    } catch (error) {
      logger.error('Failed to start ngrok tunnel', { error });
      throw error;
    }
  }

  /**
   * Stop the active ngrok tunnel.
   */
  static async stopTunnel(): Promise<void> {
    if (this.listener) {
      try {
        await this.listener.close();
        this.listener = null;
        logger.info('ngrok tunnel closed.');
      } catch (error) {
        logger.error('Failed to close ngrok tunnel', { error });
        throw error;
      }
    }
  }

  /**
   * Get the URL of the currently active tunnel, if any.
   */
  static getActiveTunnelUrl(): string | null {
    return this.listener ? this.listener.url() ?? null : null;
  }
}
