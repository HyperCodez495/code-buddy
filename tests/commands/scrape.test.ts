import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrapeCommand } from '../../src/commands/scrape.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function createProgram(command: Command): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(command);
  return program;
}

function logOutput(): string {
  return consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('buddy scrape command', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('reports a mocked Scrapling version with --check', async () => {
    const checkScrapling = vi.fn().mockResolvedValue({
      installed: true,
      pythonPath: '/fake/.venv/bin/python',
      version: '0.3.1',
    });
    const program = createProgram(createScrapeCommand({ checkScrapling }));

    await program.parseAsync(['node', 'buddy', 'scrape', '--check']);

    expect(checkScrapling).toHaveBeenCalledTimes(1);
    expect(logOutput()).toContain('Scrapling 0.3.1 detected');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('runs a mocked scrape with mode, format, and repeatable selectors', async () => {
    const runScrape = vi.fn().mockResolvedValue({ success: true, output: '# Result' });
    const program = createProgram(createScrapeCommand({ runScrape }));

    await program.parseAsync([
      'node',
      'buddy',
      'scrape',
      'https://example.com',
      '--mode',
      'dynamic',
      '--format',
      'md',
      '--css',
      'title=h1',
      '--css',
      'prices=.price',
    ]);

    expect(runScrape).toHaveBeenCalledWith({
      url: 'https://example.com',
      mode: 'dynamic',
      format: 'markdown',
      css: { title: 'h1', prices: '.price' },
    });
    expect(logOutput()).toContain('# Result');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
