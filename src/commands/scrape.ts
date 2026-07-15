import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { Command, Option } from 'commander';
import {
  WebScrapeTool,
  resolveScraplingPython,
  resolveScraplingRoot,
  type WebScrapeFormat,
  type WebScrapeInput,
  type WebScrapeMode,
} from '../tools/web-scrape-tool.js';
import type { ToolResult } from '../types/index.js';

export interface ScraplingCheckResult {
  installed: boolean;
  pythonPath: string;
  version?: string;
  error?: string;
}

export interface ScrapeCommandDependencies {
  runScrape?: (input: WebScrapeInput) => Promise<ToolResult>;
  checkScrapling?: () => Promise<ScraplingCheckResult>;
  setupScrapling?: (installBrowsers: boolean) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

interface ScrapeCommandOptions {
  mode: WebScrapeMode;
  format: 'md' | 'text' | 'html';
  css: string[];
  out?: string;
  setup?: boolean;
  browsers?: boolean;
  check?: boolean;
}

export function createScrapeCommand(deps: ScrapeCommandDependencies = {}): Command {
  const command = new Command('scrape')
    .description('Scrape a web page locally with Scrapling (web_fetch fallback when unavailable)')
    .argument('[url]', 'Public HTTP or HTTPS URL to scrape')
    .addOption(new Option('--mode <mode>', 'Scraping mode').choices(['http', 'stealth', 'dynamic']).default('http'))
    .addOption(new Option('--format <format>', 'Output format').choices(['md', 'text', 'html']).default('md'))
    .option('--css <field=selector>', 'Extract a named CSS selector (repeatable)', collectValue, [])
    .option('--out <file>', 'Write output to a file instead of stdout')
    .option('--setup', 'Install Scrapling into ~/.codebuddy/scrapling/.venv')
    .option('--browsers', 'With --setup, install browser runtimes for stealth/dynamic modes')
    .option('--check', 'Check whether Scrapling is installed and print its version')
    .action(async (url: string | undefined, options: ScrapeCommandOptions) => {
      try {
        if (options.setup) {
          const setup = deps.setupScrapling ?? setupScrapling;
          const result = await setup(options.browsers === true);
          console.log(result);
          return;
        }

        if (options.check) {
          const check = deps.checkScrapling ?? checkScrapling;
          const result = await check();
          if (result.installed) {
            console.log(`Scrapling ${result.version ?? 'version unknown'} detected (${result.pythonPath})`);
          } else {
            console.log(`Scrapling not detected (${result.pythonPath}): ${result.error ?? 'not installed'}`);
          }
          return;
        }

        if (!url) {
          failCommand('A URL is required unless --setup or --check is used.');
        }
        if (options.browsers) {
          failCommand('--browsers can only be used with --setup.');
        }

        const runScrape = deps.runScrape ?? ((input: WebScrapeInput) => new WebScrapeTool().execute(input));
        const result = await runScrape({
          url,
          mode: options.mode,
          format: mapFormat(options.format),
          ...(options.css.length > 0 ? { css: parseCssOptions(options.css) } : {}),
        });
        if (!result.success) {
          failCommand(result.error ?? 'Scrape failed');
        }

        const output = result.output ?? result.content ?? '';
        if (options.out) {
          const writeFile = deps.writeFile ?? (async (filePath: string, content: string) => {
            await fs.writeFile(filePath, content, 'utf8');
          });
          await writeFile(path.resolve(options.out), `${output}\n`);
          console.log(`Scrape written to ${path.resolve(options.out)}`);
        } else {
          console.log(output);
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'process.exit called') throw error;
        failCommand(error instanceof Error ? error.message : String(error));
      }
    });

  return command;
}

export async function checkScrapling(): Promise<ScraplingCheckResult> {
  const pythonPath = await resolveScraplingPython();
  try {
    const result = await runProcess(
      pythonPath,
      ['-c', 'from importlib.metadata import version; print(version("scrapling"))'],
      process.cwd(),
      process.env,
      15_000,
    );
    return { installed: true, pythonPath, version: lastNonEmptyLine(result.stdout) };
  } catch (error) {
    return {
      installed: false,
      pythonPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function setupScrapling(installBrowsers: boolean): Promise<string> {
  const root = resolveScraplingRoot();
  const scriptPath = path.join(root, 'setup.sh');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(installBrowsers ? { BUDDY_SCRAPLING_INSTALL_BROWSERS: '1' } : {}),
  };
  const result = await runProcess('bash', [scriptPath], root, env, 15 * 60_000);
  return [result.stdout, result.stderr].map(value => value.trim()).filter(Boolean).join('\n');
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}: ${stderr || stdout}`.slice(0, 1200)));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseCssOptions(entries: string[]): Record<string, string> {
  const selectors: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`Invalid --css value "${entry}"; expected field=selector.`);
    }
    const field = entry.slice(0, separator).trim();
    const selector = entry.slice(separator + 1).trim();
    if (!field || !selector) {
      throw new Error(`Invalid --css value "${entry}"; expected field=selector.`);
    }
    selectors[field] = selector;
  }
  return selectors;
}

function mapFormat(format: ScrapeCommandOptions['format']): WebScrapeFormat {
  return format === 'md' ? 'markdown' : format;
}

function lastNonEmptyLine(value: string): string | undefined {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
}

function failCommand(message: string): never {
  console.error(message);
  process.exit(1);
}
