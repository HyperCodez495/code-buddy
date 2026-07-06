import { describe, expect, it } from 'vitest';

import { rankByRecency, recordUse } from './command-recency-model.js';

describe('recordUse', () => {
  it('moves the used id to the front', () => {
    expect(recordUse(['build', 'test'], 'deploy')).toEqual(['deploy', 'build', 'test']);
  });

  it('deduplicates the used id', () => {
    expect(recordUse(['build', 'test', 'deploy'], 'test')).toEqual(['test', 'build', 'deploy']);
  });

  it('truncates to the cap', () => {
    expect(recordUse(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a']);
  });

  it('does not mutate the input order', () => {
    const order = ['build', 'test'];

    const nextOrder = recordUse(order, 'deploy');

    expect(order).toEqual(['build', 'test']);
    expect(nextOrder).not.toBe(order);
  });
});

describe('rankByRecency', () => {
  const commands = [
    { id: 'build', label: 'Build' },
    { id: 'test', label: 'Test' },
    { id: 'deploy', label: 'Deploy' },
    { id: 'docs', label: 'Docs' },
  ];

  it('puts recent commands first in recentIds order', () => {
    expect(rankByRecency(commands, ['deploy', 'build']).map((command) => command.id)).toEqual([
      'deploy',
      'build',
      'test',
      'docs',
    ]);
  });

  it('preserves the original order for non-recent commands', () => {
    expect(rankByRecency(commands, ['test']).map((command) => command.id)).toEqual([
      'test',
      'build',
      'deploy',
      'docs',
    ]);
  });

  it('does not lose or duplicate commands', () => {
    const ranked = rankByRecency(commands, ['deploy', 'build', 'deploy', 'unknown']);

    expect(ranked).toHaveLength(commands.length);
    expect(new Set(ranked.map((command) => command.id))).toEqual(new Set(commands.map((command) => command.id)));
  });

  it('keeps the original order when recentIds is empty', () => {
    expect(rankByRecency(commands, [])).toEqual(commands);
  });

  it('ignores unknown recent ids', () => {
    expect(rankByRecency(commands, ['unknown', 'docs']).map((command) => command.id)).toEqual([
      'docs',
      'build',
      'test',
      'deploy',
    ]);
  });
});
