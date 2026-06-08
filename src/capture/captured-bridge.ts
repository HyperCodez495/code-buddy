/**
 * CapturedBridge — Node client for the `codebuddy-captured` Rust daemon.
 *
 * Spawns the native binary and talks newline-delimited JSON-RPC over stdin/stdout
 * (same convention as the codebuddy-sidecar bridge). Offloads the frequent,
 * CPU-bound per-frame work (perceptual hashing / dedup) from the JS event loop.
 *
 * Build the binary with: `npm run build:captured` (cd src-captured && cargo build --release).
 * `isAvailable()` is false (and callers fall back to JS) when it isn't built.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import { existsSync } from 'fs';
import { join } from 'path';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface DiffResult {
  hashA: string;
  distance: number;
  similar: boolean;
}

export class CapturedBridge {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private binaryPath: string | null = null;
  private available: boolean | null = null;

  findBinary(): string | null {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '';
    const names = ['codebuddy-captured', 'codebuddy-captured.exe'];
    const dirs = [
      join(process.cwd(), 'src-captured', 'target', 'release'),
      join(process.cwd(), 'src-captured', 'target', 'debug'),
      join(home, '.cargo', 'bin'),
    ];
    for (const dir of dirs) {
      for (const name of names) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
      }
    }
    return null;
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    this.binaryPath = this.findBinary();
    this.available = this.binaryPath !== null;
    return this.available;
  }

  async start(): Promise<void> {
    if (this.process) return;
    if (!this.isAvailable() || !this.binaryPath) {
      throw new Error('codebuddy-captured not found. Build with: npm run build:captured');
    }
    this.process = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.readline = createInterface({ input: this.process.stdout!, crlfDelay: Infinity });
    this.readline.on('line', (line: string) => {
      let resp: { id: number; result?: unknown; error?: string };
      try {
        resp = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(resp.id);
      if (!p) return;
      clearTimeout(p.timeout);
      this.pending.delete(resp.id);
      if (resp.error) p.reject(new Error(resp.error));
      else p.resolve(resp.result);
    });
    this.process.on('exit', () => {
      this.process = null;
      this.readline = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timeout);
        p.reject(new Error('codebuddy-captured exited'));
      }
      this.pending.clear();
    });
  }

  stop(): void {
    this.process?.stdin?.end();
    this.process?.kill();
    this.process = null;
    this.readline?.close();
    this.readline = null;
  }

  async call(method: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<unknown> {
    if (!this.process?.stdin) await this.start();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codebuddy-captured call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.process!.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async ping(): Promise<{ ok: boolean; version: string }> {
    return (await this.call('ping', {})) as { ok: boolean; version: string };
  }

  /** Perceptual hash of an image frame (base64). */
  async phash(path: string): Promise<string> {
    return ((await this.call('phash', { path })) as { hash: string }).hash;
  }

  /** Compare a frame against another frame (`b`) or a precomputed hash (`hashB`). */
  async diff(a: string, against: { b?: string; hashB?: string }): Promise<DiffResult> {
    return (await this.call('diff', { a, ...against })) as DiffResult;
  }
}

let singleton: CapturedBridge | null = null;
export function getCapturedBridge(): CapturedBridge {
  return (singleton ??= new CapturedBridge());
}
