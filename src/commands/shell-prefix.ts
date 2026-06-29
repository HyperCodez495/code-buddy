/**
 * Shell Prefix Helpers
 *
 * This module keeps the `!` prefix parsing helpers for compatibility, but
 * direct shell execution is intentionally disabled. Callers should route shell
 * work through the validated BashTool path instead of spawning processes here.
 */

/**
 * Result of a shell command execution.
 */
export interface ShellResult {
  /** Whether the command succeeded (exit code 0). */
  success: boolean;
  /** Standard output content. */
  stdout: string;
  /** Standard error content. */
  stderr: string;
  /** Command exit code. */
  exitCode: number;
  /** Execution duration in milliseconds. */
  duration: number;
}

/**
 * Checks if input is a shell command (starts with !).
 *
 * @param input - The user input string.
 * @returns True if it's a shell command.
 */
export function isShellCommand(input: string): boolean {
  return input.trim().startsWith('!');
}

/**
 * Extracts the command string from shell prefix input.
 * Removes the '!' prefix and trims whitespace.
 *
 * @param input - The user input (e.g., "!ls").
 * @returns The command to execute (e.g., "ls").
 */
export function extractCommand(input: string): string {
  return input.trim().slice(1).trim();
}

export async function executeShellCommand(
  command: string,
  cwd: string = process.cwd(),
  timeout: number = 30000
): Promise<ShellResult> {
  void command;
  void cwd;
  void timeout;
  throw new Error('Direct shell execution via shell-prefix is disabled. Use BashTool for validated command execution.');
}

export function executeInteractiveCommand(
  command: string,
  cwd: string = process.cwd()
): Promise<number> {
  void command;
  void cwd;
  return Promise.reject(
    new Error('Interactive shell execution via shell-prefix is disabled. Use the existing interactive command flow instead.')
  );
}

/**
 * Formats shell execution result for display.
 * Includes command, output, error, exit code, and duration.
 *
 * @param command - The executed command.
 * @param result - The execution result.
 * @returns Formatted string.
 */
export function formatShellResult(command: string, result: ShellResult): string {
  const lines: string[] = [];

  lines.push(`$ ${command}`);

  if (result.stdout) {
    lines.push(result.stdout.trimEnd());
  }

  if (result.stderr && !result.success) {
    lines.push(`
Error: ${result.stderr.trimEnd()}`);
  }

  if (!result.success) {
    lines.push(`
Exit code: ${result.exitCode}`);
  }

  lines.push(`
(${result.duration}ms)`);

  return lines.join('\n');
}

/**
 * Checks if a command is interactive (needs PTY/inherit stdio).
 * Includes common interactive tools like editors, pagers, etc.
 *
 * @param command - The command to check.
 * @returns True if the command is known to be interactive.
 */
export function isInteractiveCommand(command: string): boolean {
  const interactiveCommands = [
    'vim', 'nvim', 'nano', 'emacs',
    'top', 'htop', 'less', 'more',
    'ssh', 'telnet', 'ftp',
    'python', 'node', 'irb', 'ghci',
    'git rebase -i', 'git add -i',
  ];

  const cmd = command.split(/\s+/)[0];
  return interactiveCommands.some(ic =>
    command.includes(ic) || cmd === ic
  );
}
