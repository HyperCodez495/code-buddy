/**
 * Unit tests for ShellPrefix handler
 */

import {
  isShellCommand,
  extractCommand,
  executeShellCommand,
  executeInteractiveCommand,
  formatShellResult,
  isInteractiveCommand,
} from '../../src/commands/shell-prefix';

describe('ShellPrefix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isShellCommand()', () => {
    it('should return true for input starting with !', () => {
      expect(isShellCommand('!ls -la')).toBe(true);
      expect(isShellCommand('  !git status')).toBe(true);
    });

    it('should return false for regular input', () => {
      expect(isShellCommand('hello')).toBe(false);
      expect(isShellCommand('/help')).toBe(false);
    });
  });

  describe('extractCommand()', () => {
    it('should remove ! prefix', () => {
      expect(extractCommand('!ls')).toBe('ls');
      expect(extractCommand('! git commit')).toBe('git commit');
    });
  });

  describe('executeShellCommand()', () => {
    it('should reject direct execution', async () => {
      await expect(executeShellCommand('ls')).rejects.toThrow(
        'Direct shell execution via shell-prefix is disabled'
      );
    });
  });

  describe('executeInteractiveCommand()', () => {
    it('should reject interactive execution', async () => {
      await expect(executeInteractiveCommand('vim')).rejects.toThrow(
        'Interactive shell execution via shell-prefix is disabled'
      );
    });
  });

  describe('formatShellResult()', () => {
    it('should format successful result', () => {
      const result = {
        success: true,
        stdout: 'file.txt\n',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };
      const output = formatShellResult('ls', result);
      expect(output).toContain('$ ls');
      expect(output).toContain('file.txt');
      expect(output).toContain('100ms');
    });

    it('should format error result', () => {
      const result = {
        success: false,
        stdout: '',
        stderr: 'not found',
        exitCode: 127,
        duration: 50,
      };
      const output = formatShellResult('unknown', result);
      expect(output).toContain('Error: not found');
      expect(output).toContain('Exit code: 127');
    });
  });

  describe('isInteractiveCommand()', () => {
    it('should detect known interactive commands', () => {
      expect(isInteractiveCommand('vim test.ts')).toBe(true);
      expect(isInteractiveCommand('top')).toBe(true);
      expect(isInteractiveCommand('git rebase -i HEAD~2')).toBe(true);
    });

    it('should return false for non-interactive commands', () => {
      expect(isInteractiveCommand('ls -la')).toBe(false);
      expect(isInteractiveCommand('cat file.txt')).toBe(false);
    });
  });
});
