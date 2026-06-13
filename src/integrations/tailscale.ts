/**
 * Tailscale Integration
 *
 * Manages Tailscale Serve and Funnel for exposing local services
 * to the tailnet or public internet via HTTPS.
 *
 * - Serve: expose to your tailnet only (private HTTPS)
 * - Funnel: expose to the public internet (with password auth)
 *
 * Requires `tailscale` CLI to be installed and logged in.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT = 15_000;

// ============================================================================
// Types
// ============================================================================

export interface TailscaleConfig {
  mode: 'serve' | 'funnel';
  port: number;
  hostname?: string;
  authKey?: string;
  /** Password for Funnel mode (required for public access) */
  funnelPassword?: string;
  /** URL path prefix to serve (default: /) */
  path?: string;
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  hostname: string;
  tailnetName: string;
  ip: string;
  /** Whether currently serving/funneling */
  serving: boolean;
  /** Active serve URL */
  serveUrl: string | null;
  /** Tailscale version */
  version: string;
}

export interface TailnetOllamaPeer {
  hostname: string;
  ip: string;
  baseURL: string;
  models: string[];
}

interface TailscalePeerStatus {
  Online?: boolean;
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
}

interface TailscaleStatusPayload {
  BackendState?: string;
  MagicDNSSuffix?: string;
  CurrentTailnet?: { Name?: string };
  TailscaleIPs?: string[];
  Self?: { HostName?: string; TailscaleIPs?: string[] };
  Peer?: Record<string, TailscalePeerStatus>;
}

// ============================================================================
// TailscaleManager
// ============================================================================

export class TailscaleManager {
  private static instance: TailscaleManager | null = null;
  private config: TailscaleConfig | null = null;
  private serving = false;
  private cachedStatus: TailscaleStatus | null = null;

  static getInstance(): TailscaleManager {
    if (!TailscaleManager.instance) {
      TailscaleManager.instance = new TailscaleManager();
    }
    return TailscaleManager.instance;
  }

  static resetInstance(): void {
    TailscaleManager.instance = null;
  }

  /**
   * Check if Tailscale CLI is installed.
   */
  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync('tailscale', ['version'], { timeout: EXEC_TIMEOUT });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get live Tailscale status from the CLI.
   */
  async getStatus(): Promise<TailscaleStatus> {
    const payload = await this.readStatusPayload();
    if (!payload) {
      return {
        installed: false,
        running: false,
        hostname: '',
        tailnetName: '',
        ip: '',
        serving: this.serving,
        serveUrl: null,
        version: '',
      };
    }

    const status: TailscaleStatus = {
      installed: true,
      running: !!payload.BackendState && payload.BackendState === 'Running',
      hostname: payload.Self?.HostName || '',
      tailnetName: payload.MagicDNSSuffix || payload.CurrentTailnet?.Name || '',
      ip: payload.TailscaleIPs?.[0] || payload.Self?.TailscaleIPs?.[0] || '',
      serving: this.serving,
      serveUrl: this.getServeUrl(),
      version: '',
    };

    // Get version separately (status --json doesn't always include it)
    try {
      const { stdout: ver } = await execFileAsync('tailscale', ['version'], { timeout: EXEC_TIMEOUT });
      status.version = ver.trim().split('\n')[0] ?? '';
    } catch { /* non-critical */ }

    this.cachedStatus = status;
    return status;
  }

  /**
   * Discover Ollama peers on the tailnet and return their OpenAI-compatible
   * endpoints with the models they expose.
   */
  async discoverOllamaPeers(): Promise<TailnetOllamaPeer[]> {
    const payload = await this.readStatusPayload();
    if (!payload) return [];

    const peers = payload.Peer ?? {};
    const discovered: TailnetOllamaPeer[] = [];
    for (const info of Object.values(peers)) {
      if (!info?.Online) continue;
      const ip = info.TailscaleIPs?.[0]?.trim();
      if (!ip) continue;
      const hostname = (info.HostName ?? info.DNSName ?? '').trim();
      if (!hostname) continue;
      const baseURL = `http://${ip}:11434/v1`;
      const models = await this.listOllamaModels(baseURL);
      if (!models.length) continue;
      discovered.push({ hostname, ip, baseURL, models });
    }
    return discovered;
  }

  /**
   * Start Tailscale Serve (tailnet-only HTTPS).
   */
  async serve(port: number, path?: string): Promise<boolean> {
    const servePath = path || '/';
    const target = `http://127.0.0.1:${port}`;

    try {
      // Reset any existing serve config first
      try {
        await execFileAsync('tailscale', ['serve', 'reset'], { timeout: EXEC_TIMEOUT });
      } catch { /* may not have existing config */ }

      await execFileAsync(
        'tailscale', ['serve', '--bg', `--set-path=${servePath}`, target],
        { timeout: EXEC_TIMEOUT },
      );

      this.config = {
        mode: 'serve',
        port,
        path: servePath,
        hostname: this.config?.hostname,
        authKey: this.config?.authKey,
      };
      this.serving = true;
      logger.info(`Tailscale Serve started: ${target} at ${servePath}`);
      return true;
    } catch (err) {
      logger.error('Tailscale Serve failed', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Start Tailscale Funnel (public HTTPS).
   */
  async funnel(port: number, path?: string): Promise<boolean> {
    const servePath = path || '/';
    const target = `http://127.0.0.1:${port}`;

    try {
      // Reset any existing serve config first
      try {
        await execFileAsync('tailscale', ['serve', 'reset'], { timeout: EXEC_TIMEOUT });
      } catch { /* may not have existing config */ }

      // Set up serve first, then enable funnel
      await execFileAsync(
        'tailscale', ['serve', '--bg', `--set-path=${servePath}`, target],
        { timeout: EXEC_TIMEOUT },
      );
      await execFileAsync(
        'tailscale', ['funnel', '--bg', '443', 'on'],
        { timeout: EXEC_TIMEOUT },
      );

      this.config = {
        mode: 'funnel',
        port,
        path: servePath,
        hostname: this.config?.hostname,
        authKey: this.config?.authKey,
        funnelPassword: this.config?.funnelPassword,
      };
      this.serving = true;
      logger.info(`Tailscale Funnel started: ${target} at ${servePath} (public HTTPS)`);
      return true;
    } catch (err) {
      logger.error('Tailscale Funnel failed', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Stop Tailscale Serve/Funnel.
   */
  async stop(): Promise<boolean> {
    try {
      // Turn off funnel if active
      if (this.config?.mode === 'funnel') {
        try {
          await execFileAsync('tailscale', ['funnel', '443', 'off'], { timeout: EXEC_TIMEOUT });
        } catch { /* may not be funneling */ }
      }

      await execFileAsync('tailscale', ['serve', 'reset'], { timeout: EXEC_TIMEOUT });
      this.serving = false;
      logger.info('Tailscale serve/funnel stopped');
      return true;
    } catch (err) {
      logger.debug(`Tailscale stop failed: ${err instanceof Error ? err.message : String(err)}`);
      this.serving = false;
      return false;
    }
  }

  isServing(): boolean {
    return this.serving;
  }

  /**
   * Get the current serve URL based on live status.
   */
  getServeUrl(): string | null {
    if (!this.config || !this.serving) {
      return null;
    }

    const hostname = this.cachedStatus?.hostname || this.config.hostname;
    const tailnet = this.cachedStatus?.tailnetName;
    if (!hostname) return null;

    if (tailnet) {
      return `https://${hostname}.${tailnet}`;
    }
    return `https://${hostname}`;
  }

  /**
   * Validate identity headers from Tailscale Serve proxy.
   * Tailscale adds these headers when proxying requests.
   */
  validateIdentityHeaders(headers: Record<string, string | undefined>): {
    valid: boolean;
    login?: string;
    name?: string;
    profilePicUrl?: string;
    tailnet?: string;
  } {
    const login = headers['tailscale-user-login'];
    const name = headers['tailscale-user-name'];
    const profilePic = headers['tailscale-user-profile-pic'];
    const tailnet = headers['tailscale-tailnet'];

    if (!login) {
      return { valid: false };
    }

    return {
      valid: true,
      login,
      name: name || undefined,
      profilePicUrl: profilePic || undefined,
      tailnet: tailnet || undefined,
    };
  }

  /**
   * Generate auth headers for outbound requests.
   */
  generateAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config?.authKey) {
      headers['Authorization'] = `Bearer ${this.config.authKey}`;
    }
    if (this.cachedStatus) {
      headers['Tailscale-User-Login'] = `${this.cachedStatus.hostname}@${this.cachedStatus.tailnetName}`;
    }
    return headers;
  }

  getConfig(): TailscaleConfig | null {
    return this.config ? { ...this.config } : null;
  }

  setConfig(config: Partial<TailscaleConfig>): void {
    if (this.config) {
      this.config = { ...this.config, ...config };
    } else {
      this.config = {
        mode: config.mode || 'serve',
        port: config.port || 3000,
        hostname: config.hostname,
        authKey: config.authKey,
        funnelPassword: config.funnelPassword,
        path: config.path,
      };
    }
  }

  private async readStatusPayload(): Promise<TailscaleStatusPayload | null> {
    const installed = await this.isInstalled();
    if (!installed) return null;
    try {
      const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: EXEC_TIMEOUT });
      return JSON.parse(stdout) as TailscaleStatusPayload;
    } catch (err) {
      logger.debug(`Tailscale status failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async listOllamaModels(baseURL: string): Promise<string[]> {
    const probeUrls = [`${baseURL}/models`, `${baseURL.replace(/\/v1$/, '')}/api/tags`];
    for (const url of probeUrls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) continue;
        const json = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ model?: unknown; name?: unknown }> };
        const ids = (json.data ?? json.models ?? [])
          .map((item) => {
            const record = item as { id?: unknown; model?: unknown; name?: unknown };
            const id = typeof record.id === 'string'
              ? record.id.trim()
              : typeof record.model === 'string'
                ? record.model.trim()
                : typeof record.name === 'string'
                  ? record.name.trim()
                  : '';
            return id || null;
          })
          .filter((value): value is string => Boolean(value));
        if (ids.length > 0) return ids;
      } catch {
        // try next probe
      }
    }
    return [];
  }
}
