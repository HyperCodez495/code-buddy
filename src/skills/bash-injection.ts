/**
 * Skill Bash Injection (CC11)
 *
 * Parses !`command` syntax in skill templates and replaces with command stdout.
 * Used for dynamic skill content that depends on environment state.
 *
 * Security: Commands are validated before execution and blocked if they use
 * shell-bypass patterns or other dangerous forms.
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { validateCommand } from '../tools/bash/command-validator.js';

/** Regex to match !`command` bash injection syntax */
const BASH_INJECTION_REGEX = /!`([^`]+)`/g;

/** Maximum command execution time (ms) */
const BASH_INJECTION_TIMEOUT = 10_000;

/** Maximum output size per command (chars) */
const MAX_OUTPUT_SIZE = 4_000;

/**
 * Resolve !`command` patterns in skill template content.
 *
 * Each occurrence of !`command` is replaced with the stdout of running
 * the command. If the command fails, the pattern is replaced with an
 * error comment.
 *
 * @param content - Skill template content with potential !`command` patterns
 * @param cwd - Working directory for command execution
 * @returns Content with all !`command` patterns resolved
 */
export function resolveBashInjections(content: string, cwd?: string): string {
  return content.replace(BASH_INJECTION_REGEX, (_match, command: string) => {
    try {
      const validation = validateCommand(command.trim());
      if (!validation.valid) {
        logger.debug(`Bash injection blocked: ${validation.reason}`);
        return `<!-- bash blocked: ${command} -->`;
      }

      const output = execSync(command.trim(), {
        timeout: BASH_INJECTION_TIMEOUT,
        cwd: cwd || process.cwd(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const result = output.length > MAX_OUTPUT_SIZE
        ? output.slice(0, MAX_OUTPUT_SIZE) + '\n... (truncated)'
        : output;

      logger.debug(`Bash injection resolved: ${command.slice(0, 50)}`);
      return result;
    } catch (err) {
      logger.debug(`Bash injection failed for "${command}": ${err}`);
      return `<!-- bash error: ${command} -->`;
    }
  });
}

/**
 * Check if content contains any bash injection patterns.
 */
export function hasBashInjections(content: string): boolean {
  BASH_INJECTION_REGEX.lastIndex = 0;
  return BASH_INJECTION_REGEX.test(content);
}
