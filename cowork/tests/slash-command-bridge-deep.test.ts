import { describe, expect, it } from 'vitest';
import {
  buildDeepResearchGuidance,
  parseDeepSlashArgs,
  SlashCommandBridge,
} from '../src/main/commands/slash-command-bridge';

describe('parseDeepSlashArgs', () => {
  it('treats bare words as the topic', () => {
    expect(parseDeepSlashArgs(['transformer', 'attention', 'mechanisms'])).toEqual({
      topic: 'transformer attention mechanisms',
    });
  });

  it('extracts --iterations / --perspectives and keeps the rest as the topic (order-agnostic)', () => {
    expect(
      parseDeepSlashArgs(['--iterations', '3', 'quantum', 'error', 'correction', '--perspectives', '4']),
    ).toEqual({
      topic: 'quantum error correction',
      iterations: 3,
      perspectives: 4,
    });
  });

  it('supports the --flag=value form', () => {
    expect(parseDeepSlashArgs(['CRISPR', '--iterations=2', '--perspectives=5'])).toEqual({
      topic: 'CRISPR',
      iterations: 2,
      perspectives: 5,
    });
  });

  it('clamps iterations to [1,3] and perspectives to [2,6]', () => {
    expect(parseDeepSlashArgs(['topic', '--iterations', '9', '--perspectives', '99'])).toEqual({
      topic: 'topic',
      iterations: 3,
      perspectives: 6,
    });
    expect(parseDeepSlashArgs(['topic', '--perspectives', '1'])).toEqual({
      topic: 'topic',
      perspectives: 2,
    });
  });

  it('drops a flag with a missing/invalid value without swallowing the topic', () => {
    // Trailing flag with no value → simply dropped.
    expect(parseDeepSlashArgs(['topic', '--iterations'])).toEqual({ topic: 'topic' });
    // Non-numeric "value" is not consumed by the flag — it falls through as topic text.
    expect(parseDeepSlashArgs(['--iterations', 'notanumber', 'topic'])).toEqual({
      topic: 'notanumber topic',
    });
  });
});

describe('buildDeepResearchGuidance', () => {
  it('produces a Pattern-A guidance that names the deep_research tool and the topic', () => {
    const guidance = buildDeepResearchGuidance({ topic: 'photosynthesis' });
    expect(guidance).toContain('deep_research');
    expect(guidance).toContain("mode: 'deep'");
    expect(guidance).toContain('"photosynthesis"');
    expect(guidance).toContain('## Références');
    // No optional flags mentioned when not provided.
    expect(guidance).not.toContain('iterations');
    expect(guidance).not.toContain('perspectives');
  });

  it('mentions iterations / perspectives when provided', () => {
    const guidance = buildDeepResearchGuidance({ topic: 'x', iterations: 2, perspectives: 4 });
    expect(guidance).toContain('iterations: 2');
    expect(guidance).toContain('perspectives: 4');
  });
});

describe('SlashCommandBridge /deep execution', () => {
  const bridgeWithDeep = () => {
    const bridge = new SlashCommandBridge();
    bridge.listCommands = async () => [
      {
        name: 'deep',
        description: 'Deep Research',
        prompt:
          'Use the deep_research tool (mode: deep) to produce a multi-source, cited report. Topic: {{args}}',
        isBuiltin: true,
      },
    ];
    return bridge;
  };

  it('forwards a guidance prompt (handled=false) for a real topic', async () => {
    const result = await bridgeWithDeep().execute('deep', ['scaling', 'laws', '--perspectives', '4']);
    expect(result.success).toBe(true);
    expect(result.handled).toBe(false);
    expect(result.prompt).toContain('deep_research');
    expect(result.prompt).toContain('"scaling laws"');
    expect(result.prompt).toContain('perspectives: 4');
  });

  it('returns a usage toast when no topic is given', async () => {
    const result = await bridgeWithDeep().execute('deep', ['--iterations', '2']);
    expect(result.success).toBe(true);
    expect(result.handled).toBe(true);
    expect(result.prompt).toBeUndefined();
    expect(result.message).toContain('/deep');
  });
});
