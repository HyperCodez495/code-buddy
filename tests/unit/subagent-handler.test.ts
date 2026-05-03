/**
 * Tests for the `/subagent` slash command handler.
 *
 * Read-only handler that surfaces `PREDEFINED_SUBAGENTS` to users.
 * Shipped to make the rc.4 Explore subagent + code-reviewer hardening
 * discoverable from the CLI.
 */

import { describe, it, expect } from 'vitest';
import { handleSubagent } from '@/commands/handlers/subagent-handler.js';

describe('handleSubagent — /subagent slash command', () => {
  describe('list (default action)', () => {
    it('lists all PREDEFINED_SUBAGENTS with no args', () => {
      const result = handleSubagent([]);
      expect(result.handled).toBe(true);
      const c = result.entry?.content as string;
      expect(c).toContain('Available subagents');
      // The 7 predefined subagents (Explore + explorer alias + 5 others) should all appear
      expect(c).toContain('Explore');
      expect(c).toContain('code-reviewer');
      expect(c).toContain('debugger');
      expect(c).toContain('test-runner');
      expect(c).toContain('refactorer');
      expect(c).toContain('documenter');
    });

    it('lists with explicit "list" action (same as default)', () => {
      const noArgs = handleSubagent([]);
      const explicitList = handleSubagent(['list']);
      expect(explicitList.entry?.content).toBe(noArgs.entry?.content);
    });

    it('shows tools whitelist + blocked list per entry', () => {
      const c = handleSubagent([]).entry?.content as string;
      // Each subagent line includes "tools:" and "blocked:" markers
      expect(c).toMatch(/tools:.*view_file/);
      expect(c).toMatch(/blocked:/);
    });

    it('footer hints toward `info` and `help`', () => {
      const c = handleSubagent([]).entry?.content as string;
      expect(c).toContain('/subagent info');
      expect(c).toContain('/subagent help');
    });
  });

  describe('info <name>', () => {
    it('shows full details for Explore (READ-ONLY MODE prompt + restrictions)', () => {
      const result = handleSubagent(['info', 'Explore']);
      expect(result.handled).toBe(true);
      const c = result.entry?.content as string;
      expect(c).toContain('Subagent: Explore');
      expect(c).toContain('Tools whitelist:');
      expect(c).toContain('Tools blacklist:');
      expect(c).toContain('System prompt:');
      // Explore's strict READ-ONLY MODE phrase must be in the prompt preview
      expect(c).toContain('READ-ONLY MODE');
    });

    it('shows code-reviewer with the new hardened blacklist (rc.4)', () => {
      const c = handleSubagent(['info', 'code-reviewer']).entry?.content as string;
      expect(c).toContain('Subagent: code-reviewer');
      // The blacklist added in this commit should be visible
      expect(c).toContain('str_replace_editor');
      expect(c).toContain('create_file');
      expect(c).toContain('bash');
    });

    it('case-insensitive match: "explore" finds "Explore"', () => {
      const exact = handleSubagent(['info', 'Explore']).entry?.content as string;
      const lower = handleSubagent(['info', 'explore']).entry?.content as string;
      // Both should resolve to a valid info view (not the "not found" message)
      expect(exact).toContain('Subagent:');
      expect(lower).toContain('Subagent:');
    });

    it('returns helpful error + suggestions when name is unknown', () => {
      const c = handleSubagent(['info', 'nonexistent-thing']).entry?.content as string;
      expect(c).toContain('not found');
      expect(c).toContain('Available:');
      // Suggestions list should contain at least one real subagent
      expect(c).toContain('Explore');
    });

    it('returns usage when no name passed', () => {
      const c = handleSubagent(['info']).entry?.content as string;
      expect(c).toContain('Usage: /subagent info <name>');
      expect(c).toContain('Available:');
    });
  });

  describe('help', () => {
    it('shows usage for help action', () => {
      const c = handleSubagent(['help']).entry?.content as string;
      expect(c).toContain('Usage: /subagent');
      expect(c).toContain('list');
      expect(c).toContain('info');
      expect(c).toContain('help');
    });
  });

  describe('error handling', () => {
    it('shows error + help for unknown action', () => {
      const c = handleSubagent(['definitely-not-an-action']).entry?.content as string;
      expect(c).toContain('Unknown action');
      expect(c).toContain('Usage: /subagent');
    });
  });
});
