import * as path from 'node:path';
import { Command } from 'commander';
import { WorkspaceSearchTool } from '../tools/workspace-tools.js';
import {
  getWorkspace,
  inspectWorkspaceConfig,
  readWorkspaceConfigForEdit,
  resolveWorkspaceConfigPath,
  validateWorkspaceRepo,
  writeWorkspaceConfig,
  type WorkspaceConfigOptions,
} from '../workspace/workspace-config.js';

export interface WsCommandOptions {
  cwd?: string;
  homeDir?: string;
  output?: (message: string) => void;
}

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createWsCommand(options: WsCommandOptions = {}): Command {
  const command = new Command('ws');
  const output = options.output ?? ((message: string) => console.log(message));
  const configOptions: WorkspaceConfigOptions = {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
  };
  const cwd = options.cwd ?? process.cwd();

  command.description('Manage and search the opt-in multi-repository workspace');

  command
    .command('list')
    .alias('ls')
    .description('List configured repositories and their validity')
    .action(() => {
      const inspection = inspectWorkspaceConfig(configOptions);
      if (!inspection.configPath) {
        output('No workspace configuration found.');
        return;
      }
      output(`Workspace: ${inspection.configPath}`);
      if (inspection.error) {
        output(`invalid: ${inspection.error}`);
        return;
      }
      if (inspection.entries.length === 0) {
        output('No repositories configured.');
        return;
      }
      for (const entry of inspection.entries) {
        const location = entry.normalizedPath ?? entry.path;
        const suffix = entry.valid ? '' : ` (${entry.reason ?? 'invalid'})`;
        output(`${entry.valid ? 'valid' : 'invalid'}\t${entry.name}\t${location}${suffix}`);
      }
    });

  command
    .command('add <name> <path>')
    .description('Add a git repository to the resolved workspace.json')
    .action((name: string, repoPath: string) => {
      const configPath = resolveWorkspaceConfigPath({ ...configOptions, forWrite: true });
      if (!configPath) throw new Error('Run buddy ws add from inside a git repository');
      const repo = { name: name.trim(), path: path.resolve(cwd, repoPath) };
      const inspection = validateWorkspaceRepo(repo, configPath);
      if (!inspection.valid || !inspection.normalizedPath) {
        throw new Error(`Cannot add repository "${name}": ${inspection.reason ?? 'invalid repository'}`);
      }
      const current = readWorkspaceConfigForEdit(configPath);
      if (current.repos.some((entry) => entry.name === inspection.name)) {
        throw new Error(`Workspace repository already exists: ${inspection.name}`);
      }
      current.repos.push({ name: inspection.name, path: inspection.normalizedPath });
      writeWorkspaceConfig(configPath, current.repos);
      output(`Added ${inspection.name}: ${inspection.normalizedPath}`);
    });

  command
    .command('rm <name>')
    .alias('remove')
    .description('Remove a repository from the resolved workspace.json')
    .action((name: string) => {
      const configPath = resolveWorkspaceConfigPath(configOptions);
      if (!configPath) throw new Error('No workspace configuration found');
      const current = readWorkspaceConfigForEdit(configPath);
      const remaining = current.repos.filter((entry) => entry.name !== name);
      if (remaining.length === current.repos.length) {
        throw new Error(`Unknown workspace repository: ${name}`);
      }
      writeWorkspaceConfig(configPath, remaining);
      output(`Removed ${name}`);
    });

  command
    .command('search <query>')
    .description('Search the enabled multi-repository workspace')
    .option('-r, --repo <name>', 'Restrict search to a repository (repeatable)', collectRepo, [])
    .option('-m, --max-results <number>', 'Maximum aggregated matches', (value: string) => Number(value))
    .option('-g, --glob <pattern>', 'Optional include glob')
    .action(async (
      query: string,
      searchOptions: { repo: string[]; maxResults?: number; glob?: string },
    ) => {
      const tool = new WorkspaceSearchTool({
        workspaceProvider: (providerOptions) => getWorkspace({ ...configOptions, ...providerOptions }),
      });
      const result = await tool.execute({
        query,
        ...(searchOptions.repo.length > 0 ? { repos: searchOptions.repo } : {}),
        ...(searchOptions.maxResults !== undefined ? { max_results: searchOptions.maxResults } : {}),
        ...(searchOptions.glob !== undefined ? { glob: searchOptions.glob } : {}),
      }, { cwd });
      if (!result.success) throw new Error(result.error ?? 'Workspace search failed');
      output(result.output ?? '');
    });

  return command;
}
