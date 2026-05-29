/**
 * Chrome Discovery
 *
 * Native Engine v2026.3.13 alignment: detect running Chrome instances with
 * remote debugging enabled. Cross-platform support (macOS/Linux/Windows).
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface ChromeInstance {
  /** CDP WebSocket URL */
  cdpUrl: string;
  /** Process ID */
  pid?: number;
  /** CDP port */
  port: number;
}

/**
 * Find running Chrome instances with remote debugging enabled.
 *
 * Detection strategy:
 * - macOS/Linux: `lsof` or `ss` to find processes listening on common CDP ports
 * - Windows: `netstat` to find listening ports
 *
 * Checks ports 9222-9229 (common CDP debugging range).
 */
export function findRunningChrome(): ChromeInstance[] {
  const instances: ChromeInstance[] = [];
  const cdpPorts = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229];

  for (const port of cdpPorts) {
    if (isPortListening(port)) {
      // Verify it's actually Chrome CDP by trying to fetch /json/version
      if (isCDPEndpoint(port)) {
        instances.push({
          cdpUrl: `http://127.0.0.1:${port}`,
          port,
        });
      }
    }
  }

  return instances;
}

/**
 * Check if a port is listening on localhost
 */
function isPortListening(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
        { stdio: 'pipe', timeout: 3000 }
      ).toString();
      return output.trim().length > 0;
    } else if (process.platform === 'darwin') {
      const output = execSync(
        `lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null`,
        { stdio: 'pipe', timeout: 3000 }
      ).toString();
      return output.trim().length > 0;
    } else {
      // Linux
      const output = execSync(
        `ss -tlnp 'sport = :${port}' 2>/dev/null`,
        { stdio: 'pipe', timeout: 3000 }
      ).toString();
      return output.includes(`:${port}`);
    }
  } catch {
    return false;
  }
}

/**
 * Verify that a port is serving Chrome DevTools Protocol
 */
function isCDPEndpoint(port: number): boolean {
  try {
    const output = execSync(
      `node -e "const http=require('http');const r=http.get('http://127.0.0.1:${port}/json/version',{timeout:2000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);process.exit(j.Browser?0:1)}catch{process.exit(1)}})});r.on('error',()=>process.exit(1))"`,
      { stdio: 'pipe', timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-discover Chrome and return the best CDP URL.
 *
 * Priority:
 * 1. CDP_URL environment variable
 * 2. Running Chrome instance (auto-discovery)
 * 3. null (fallback to launching chrome-relay)
 */
export function discoverChromeEndpoint(): string | null {
  // 1. Environment variable
  const envUrl = process.env.CDP_URL;
  if (envUrl) {
    logger.debug(`Chrome CDP from env: ${envUrl}`);
    return envUrl;
  }

  // 2. Auto-discovery
  const instances = findRunningChrome();
  const firstInstance = instances[0];
  if (firstInstance) {
    logger.debug(`Chrome auto-discovered at ${firstInstance.cdpUrl}`);
    return firstInstance.cdpUrl;
  }

  return null;
}
