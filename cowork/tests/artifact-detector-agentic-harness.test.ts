import { describe, expect, it } from 'vitest';

import { detectArtifacts } from '../src/renderer/utils/artifact-detector';

describe('detectArtifacts agentic harness titles', () => {
  it('labels Cowork workspace JSON artifacts that include a harness contract', () => {
    const workspace = {
      harness: {
        canExecute: false,
        contractTerms: [{ id: 'run', label: 'Run' }],
        executionMode: 'display_only',
        kind: 'agentic-coding-harness-contract',
        mode: 'passive',
      },
      kind: 'agentic-coding-proposal-loop-cowork-workspace',
    };

    const artifacts = detectArtifacts(
      ['Open this workspace artifact:', '```json', JSON.stringify(workspace, null, 2), '```'].join(
        '\n'
      )
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toEqual(
      expect.objectContaining({
        kind: 'json',
        title: 'Agentic Cowork workspace harness',
      })
    );
  });

  it('labels direct harness JSON artifacts', () => {
    const artifacts = detectArtifacts(
      [
        '```json',
        JSON.stringify({
          canExecute: false,
          contractTerms: [{ id: 'run', label: 'Run' }],
          executionMode: 'display_only',
          kind: 'agentic-coding-harness-contract',
          mode: 'passive',
        }),
        '```',
      ].join('\n')
    );

    expect(artifacts[0]?.title).toBe('Agentic harness contract');
  });
});
