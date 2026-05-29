/**
 * Edit application + verification execution for the agentic-coding runner.
 *
 * Extracted from agentic-coding-runner.ts to break the
 * `agentic-coding-runner ↔ verification-loop` import cycle (Phase 2.1 cycle 3)
 * and to continue decomposing the 8.4K-LOC god file (Phase 2.2). The runner and
 * verification-loop both import from here; this module never value-imports the
 * runner (types only), so no cycle is reintroduced.
 *
 * SECURITY — secret redaction: this module installs a global patch on
 * `fs.writeFile` that redacts secrets on string writes EXCEPT while declared
 * edits are being applied (`isApplyingEdits`). The patch MUST stay on the
 * DEFAULT export of `node:fs/promises` (`import fs from ...`) — the singleton is
 * shared across modules, so a namespace import would silently bypass redaction.
 * Behaviour is pinned by tests/agent/autonomous/agentic-coding-redaction.test.ts.
 */
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { redactSecrets } from '../../security/data-redaction.js';
import { validateCommand } from '../../utils/input-validation/command-validator.js';
import { isPathAllowedByContract, resolveRepoPath } from './agentic-coding-paths.js';
import type { AgenticCodingTaskContract } from './agentic-coding-contract.js';
import type {
  AgenticCodingEditResult,
  AgenticCodingEditPreview,
  AgenticCodingVerificationResult,
} from './agentic-coding-runner.js';

const MAX_CAPTURE_CHARS = 4000;

let isApplyingEdits = false;
const originalWriteFile = fs.writeFile;
fs.writeFile = function (
  path: any,
  data: any,
  options?: any
): Promise<void> {
  if (!isApplyingEdits && typeof data === 'string') {
    data = redactSecrets(data);
  }
  return originalWriteFile.call(fs, path, data, options);
} as any;

export async function persistRunArtifact(filePath: string, content: string): Promise<void> {
  const redacted = redactSecrets(content);
  await originalWriteFile(filePath, redacted, 'utf8');
}

const execAsync = promisify(exec);

function truncateOutput(value: string): string {
  if (value.length <= MAX_CAPTURE_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_CAPTURE_CHARS)}\n...[truncated ${value.length - MAX_CAPTURE_CHARS} chars]`;
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let index = value.indexOf(search);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(search, index + search.length);
  }

  return count;
}

export async function applyDeclaredEdits(
  contract: AgenticCodingTaskContract,
): Promise<AgenticCodingEditResult[]> {
  isApplyingEdits = true;
  try {
    const results: AgenticCodingEditResult[] = [];

    for (const edit of contract.edits) {
      if (!isPathAllowedByContract(edit.path, contract.allowedPaths)) {
        results.push({
          occurrences: 0,
          path: edit.path,
          reason: `edit path is outside allowedPaths: ${edit.path}`,
          status: 'blocked',
        });
        continue;
      }

      const resolved = resolveRepoPath(contract.repo, edit.path);
      if (!resolved.path) {
        results.push({
          occurrences: 0,
          path: edit.path,
          reason: resolved.reason ?? 'edit path failed repository safety check',
          status: 'blocked',
        });
        continue;
      }

      try {
        const current = await fs.readFile(resolved.path, 'utf8');
        const occurrences = countOccurrences(current, edit.find);

        if (occurrences !== edit.expectedOccurrences) {
          results.push({
            occurrences,
            path: edit.path,
            reason: `expected ${edit.expectedOccurrences} occurrence(s), found ${occurrences}`,
            status: 'blocked',
          });
          continue;
        }

        await fs.writeFile(resolved.path, current.split(edit.find).join(edit.replace), 'utf8');
        results.push({
          occurrences,
          path: edit.path,
          status: 'applied',
        });
      } catch (error) {
        results.push({
          occurrences: 0,
          path: edit.path,
          reason: error instanceof Error ? error.message : String(error),
          status: 'failed',
        });
      }
    }

    return results;
  } finally {
    isApplyingEdits = false;
  }
}

export async function previewDeclaredEdits(
  contract: AgenticCodingTaskContract,
): Promise<AgenticCodingEditPreview[]> {
  const previews: AgenticCodingEditPreview[] = [];

  for (const edit of contract.edits) {
    if (!isPathAllowedByContract(edit.path, contract.allowedPaths)) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: `edit path is outside allowedPaths: ${edit.path}`,
        status: 'blocked',
      });
      continue;
    }

    const resolved = resolveRepoPath(contract.repo, edit.path);
    if (!resolved.path) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: resolved.reason ?? 'edit path failed repository safety check',
        status: 'blocked',
      });
      continue;
    }

    try {
      const current = await fs.readFile(resolved.path, 'utf8');
      const occurrences = countOccurrences(current, edit.find);

      if (occurrences !== edit.expectedOccurrences) {
        previews.push({
          after: '',
          before: truncateOutput(current),
          occurrences,
          path: edit.path,
          reason: `expected ${edit.expectedOccurrences} occurrence(s), found ${occurrences}`,
          status: 'blocked',
        });
        continue;
      }

      previews.push({
        after: truncateOutput(current.split(edit.find).join(edit.replace)),
        before: truncateOutput(current),
        occurrences,
        path: edit.path,
        status: 'previewed',
      });
    } catch (error) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: error instanceof Error ? error.message : String(error),
        status: 'failed',
      });
    }
  }

  return previews;
}

function isCommandNotFound(error: any, stderr: string): boolean {
  if (error.code === 'ENOENT' || error.code === 127 || error.code === 9009) {
    return true;
  }
  const msg = (error.message || '').toLowerCase();
  const errText = stderr.toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('enoent') ||
    msg.includes('not recognized') ||
    errText.includes('not found') ||
    errText.includes('enoent') ||
    errText.includes('not recognized')
  );
}

export async function runVerificationCommands(
  contract: AgenticCodingTaskContract,
  timeoutMs: number,
): Promise<AgenticCodingVerificationResult[]> {
  const results: AgenticCodingVerificationResult[] = [];

  for (const command of contract.verification) {
    const validation = validateCommand(command);
    if (!validation.valid) {
      results.push({
        command,
        exitCode: 1,
        reason: validation.error ?? 'command failed validation',
        status: 'blocked',
        stderr: '',
        stdout: '',
      });
      continue;
    }

    try {
      const result = await execAsync(command, {
        cwd: contract.repo,
        timeout: timeoutMs,
        windowsHide: true,
      });
      results.push({
        command,
        exitCode: 0,
        status: 'passed',
        stderr: truncateOutput(String(result.stderr)),
        stdout: truncateOutput(String(result.stdout)),
      });
    } catch (error) {
      const commandError = error as Error & {
        code?: number;
        stderr?: string | Buffer;
        stdout?: string | Buffer;
      };
      const stderrStr = String(commandError.stderr ?? '');
      const isBlocked = isCommandNotFound(commandError, stderrStr);
      results.push({
        command,
        exitCode: typeof commandError.code === 'number' ? commandError.code : 1,
        reason: commandError.message,
        status: isBlocked ? 'blocked' : 'failed',
        stderr: truncateOutput(stderrStr),
        stdout: truncateOutput(String(commandError.stdout ?? '')),
      });
    }
  }

  return results;
}
