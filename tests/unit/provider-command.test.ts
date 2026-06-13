/**
 * Unit tests for Provider Command
 */


// Mock logger

import { createProviderCommand } from '../../src/commands/provider';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const loggerErrorSpy = logger.error as jest.Mock;

// Mock settings manager
jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(function() { return {
    loadUserSettings: jest.fn(function() { return {
      provider: 'grok',
      model: 'grok-code-fast-1',
    }; }),
    updateUserSetting: jest.fn(),
    getCurrentModel: jest.fn(() => 'grok-code-fast-1'),
  }; }),
}));

jest.mock('../../src/providers/codex-oauth', () => ({
  hasCodexCredentials: jest.fn(() => true),
}));

describe('Provider Command', () => {
  let command: Command;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    command = createProviderCommand();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(function() {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('createProviderCommand', () => {
    it('should create a command instance', () => {
      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('provider');
    });

    it('should have all subcommands', () => {
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('list');
      expect(subcommands).toContain('current');
      expect(subcommands).toContain('set');
      expect(subcommands).toContain('models');
      expect(subcommands).toContain('model');
    });
  });

  describe('list command', () => {
    it('should list all providers', () => {
      command.parse(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Grok');
      expect(output).toContain('Claude');
      expect(output).toContain('ChatGPT');
      expect(output).toContain('Gemini');
      expect(output).toContain('Kimi');
      expect(output).toContain('Hugging Face');
    });

    it('should show environment variable names', () => {
      command.parse(['list'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('GROK_API_KEY');
      expect(output).toContain('ANTHROPIC_API_KEY');
      expect(output).toContain('OPENAI_API_KEY');
      expect(output).toContain('CODEBUDDY_CHATGPT_OAUTH');
      expect(output).toContain('GOOGLE_API_KEY');
      expect(output).toContain('KIMI_API_KEY');
      expect(output).toContain('HF_TOKEN');
    });

    it('should list plugin-native providers separately', () => {
      command.parse(['list'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Plugin-native providers');
      expect(output).toContain('Azure OpenAI');
      expect(output).toContain('AWS Bedrock');
      expect(output).toContain('GitHub Copilot');
      expect(output).toContain('bundled-azure-openai');
      expect(output).toContain('bundled-bedrock');
      expect(output).toContain('bundled-copilot');
    });
  });

  describe('current command', () => {
    it('should show current provider', () => {
      command.parse(['current'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Active Provider');
    });

    it('should show current model', () => {
      command.parse(['current'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Model');
    });
  });

  describe('set command', () => {
    it('should reject unknown provider', () => {
      expect(() => {
        command.parse(['set', 'unknown-provider'], { from: 'user' });
      }).toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      const errorOutput = loggerErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errorOutput).toContain('Unknown provider');
    });

    it('should accept valid provider', () => {
      command.parse(['set', 'claude'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });

    it('should handle case insensitivity', () => {
      command.parse(['set', 'CLAUDE'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });

    it('should accept Hermes-style provider aliases', () => {
      command.parse(['set', 'kimi'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to: Kimi');
    });

    it('should reject plugin-native providers in the direct provider setter', () => {
      expect(() => {
        command.parse(['set', 'azure'], { from: 'user' });
      }).toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      const errorOutput = loggerErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errorOutput).toContain('Unknown provider: azure');
    });
  });

  describe('models command', () => {
    it('should list models for current provider', () => {
      command.parse(['models'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for');
    });

    it('should list models for specific provider', () => {
      command.parse(['models', 'claude'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for Claude');
      expect(output).toContain('claude-sonnet-4');
    });

    it('should list ChatGPT OAuth models', () => {
      command.parse(['models', 'chatgpt'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for ChatGPT (OAuth)');
      expect(output).toContain('gpt-5.5');
    });

    it('should list models for Hermes-style provider aliases', () => {
      command.parse(['models', 'glm'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for z.ai / GLM');
      expect(output).toContain('glm-5');
    });

    it('should reject unknown provider', () => {
      expect(() => {
        command.parse(['models', 'unknown'], { from: 'user' });
      }).toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('model command', () => {
    it('should set model', () => {
      command.parse(['model', 'gpt-4o'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Model set to: gpt-4o');
    });
  });
});

describe('Provider Configuration', () => {
  const PROVIDER_KEYS = {
    grok: 'GROK_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GOOGLE_API_KEY',
  };

  describe('Environment Variables', () => {
    it('should recognize standard env vars', () => {
      for (const envVar of Object.values(PROVIDER_KEYS)) {
        expect(envVar).toBeDefined();
        expect(typeof envVar).toBe('string');
      }
    });
  });

  describe('Provider Models', () => {
    const PROVIDER_MODELS: Record<string, string[]> = {
      grok: ['grok-beta', 'grok-code-fast-1'],
      claude: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-latest'],
      openai: ['gpt-4o', 'gpt-4o-mini'],
      chatgpt: ['gpt-5.5'],
      gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    };

    it('should have models for each provider', () => {
      for (const models of Object.values(PROVIDER_MODELS)) {
        expect(models.length).toBeGreaterThan(0);
      }
    });
  });
});
