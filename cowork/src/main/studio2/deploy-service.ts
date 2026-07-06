import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { errorMessage, fail, ok, safeResolve, type Studio2Result, zipDirectory } from './archive-utils.js';

const execFileAsync = promisify(execFile);

export type DeployTarget = 'surge' | 'netlify' | 'vercel' | 'zip';
export interface DeployRequest { projectRoot: string; buildDir?: string; target?: DeployTarget; }
export interface DeployResult { target: DeployTarget; mode: 'cli' | 'zip'; outputPath?: string; publicUrl?: string; cli?: string; log: string; }

const CLI_BY_TARGET: Record<Exclude<DeployTarget, 'zip'>, string[]> = {
  surge: ['surge'], netlify: ['netlify', 'netlify-cli'], vercel: ['vercel', 'vercel-cli'],
};
function whichCommand(): string { return process.platform === 'win32' ? 'where' : 'which'; }
function deployArgs(target: Exclude<DeployTarget, 'zip'>, buildDir: string): string[] {
  if (target === 'surge') return [buildDir];
  if (target === 'netlify') return ['deploy', '--dir', buildDir];
  return ['deploy', buildDir];
}
function extractUrl(output: string): string | undefined { return output.match(/https?:\/\/\S+/)?.[0]; }

export class DeployService {
  async detectCli(target: Exclude<DeployTarget, 'zip'>): Promise<string | null> {
    for (const candidate of CLI_BY_TARGET[target]) {
      try { await execFileAsync(whichCommand(), [candidate]); return candidate; } catch { /* candidate absent — try the next one */ }
    }
    return null;
  }
  async deploy(request: DeployRequest): Promise<Studio2Result<DeployResult>> {
    try {
      const projectRoot = safeResolve(request.projectRoot);
      if (!projectRoot) return fail('Invalid project root');
      const buildDir = safeResolve(projectRoot, request.buildDir ?? 'dist');
      if (!buildDir) return fail('Invalid build directory');
      const stat = await fs.stat(buildDir).catch(() => null);
      if (!stat?.isDirectory()) return fail('Build directory does not exist');
      const preferred = request.target ?? 'zip';
      if (preferred !== 'zip') {
        const cli = await this.detectCli(preferred);
        if (cli) {
          try {
            const { stdout, stderr } = await execFileAsync(cli, deployArgs(preferred, buildDir), { cwd: projectRoot });
            const log = (String(stdout) + String(stderr)).trim();
            return ok({ target: preferred, mode: 'cli', cli, publicUrl: extractUrl(log), log });
          } catch (error) {
            return ok(await this.zipFallback(projectRoot, buildDir, preferred, 'CLI failed: ' + errorMessage(error)));
          }
        }
      }
      return ok(await this.zipFallback(projectRoot, buildDir, 'zip', 'No static deploy CLI available; created local zip.'));
    } catch (error) { return fail(errorMessage(error)); }
  }
  private async zipFallback(projectRoot: string, buildDir: string, target: DeployTarget, log: string): Promise<DeployResult> {
    const outputPath = path.join(projectRoot, '.studio2', 'deploy-' + Date.now() + '.zip');
    await zipDirectory(buildDir, outputPath);
    return { target, mode: 'zip', outputPath, log };
  }
}
export function deployProject(request: DeployRequest): Promise<Studio2Result<DeployResult>> { return new DeployService().deploy(request); }
