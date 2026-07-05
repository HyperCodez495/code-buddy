import http from 'http';
import https from 'https';
import { isLoopbackHost } from '../security/dev-origins.js';
import type { ToolResult } from '../types/index.js';
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function probe(url: URL, timeoutMs: number): Promise<{ status: number; headers: Record<string, string | string[]>; size: number }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; });
      res.on('end', () => {
        const headers = Object.fromEntries(
          Object.entries(res.headers).filter((entry): entry is [string, string | string[]] => typeof entry[1] === 'string' || Array.isArray(entry[1])),
        );
        resolve({ status: res.statusCode ?? 0, headers, size });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('HTTP probe timed out')); });
    req.on('error', reject);
  });
}
export class HttpProbeTool { readonly name = 'http_probe'; readonly description = 'GET a loopback-only URL and return status, headers, and response size.'; async execute(input: unknown): Promise<ToolResult> { try { if (!isRecord(input)) return { success: false, error: 'Input must be an object' }; if (typeof input.url !== 'string') return { success: false, error: 'url must be a string' }; const url = new URL(input.url); if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHost(url.hostname)) return { success: false, error: 'http_probe only allows http(s) loopback URLs' }; const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 10_000, 500), 30_000); const result = await probe(url, timeoutMs); return { success: result.status >= 200 && result.status < 400, output: `HTTP ${result.status}, ${result.size} byte(s)`, data: { url: url.toString(), ...result } }; } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; } } }
export const HTTP_PROBE_TOOL_DEFINITION = { type: 'function' as const, function: { name: 'http_probe', description: 'GET loopback-only URL and return status, headers and size.', parameters: { type: 'object', properties: { url: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['url'] } } };
