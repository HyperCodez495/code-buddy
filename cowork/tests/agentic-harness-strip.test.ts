/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgenticHarnessStrip,
  buildAgenticHarnessGoal,
  parseAgenticHarnessArtifact,
  summarizeAgenticHarness,
  type AgenticHarnessContract,
} from '../src/renderer/components/agentic-harness-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>
    ) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template
      );
    },
  }),
}));

const harness: AgenticHarnessContract = {
  activeState: {
    approvalState: 'needs_approval',
    readyCommandCount: 2,
    supervisionState: 'human_review_required',
    workspaceStatus: 'needs_review',
  },
  canExecute: false,
  contractTerms: [
    { id: 'run', label: 'Run', safetyNote: 'A run needs a bounded goal.' },
    { id: 'evidence', label: 'Evidence', safetyNote: 'Claims need proof.' },
    { id: 'sensitive-action', label: 'Sensitive action', safetyNote: 'Approval required.' },
    { id: 'workflow', label: 'Workflow', safetyNote: 'Steps are explicit.' },
    { id: 'human-approval', label: 'Human approval', safetyNote: 'Humans decide.' },
    { id: 'memory-or-lesson', label: 'Memory or lesson', safetyNote: 'Write only useful memory.' },
    { id: 'agent-boundary', label: 'Agent boundary', safetyNote: 'No hidden authority.' },
  ],
  executionMode: 'display_only',
  hermes: {
    agentId: 'hermes',
    dispatchProfile: 'balanced',
    lifecycleStages: [
      {
        blocksOperation: true,
        label: 'Before tool call',
        stage: 'before_tool_call',
      },
      {
        blocksOperation: false,
        label: 'After tool call',
        stage: 'after_tool_call',
      },
      {
        blocksOperation: true,
        label: 'Before memory write',
        stage: 'before_memory_write',
      },
    ],
    nativeSurfaces: [
      { id: 'tools', label: 'Tools' },
      { id: 'lessons', label: 'Lessons' },
    ],
    operatingRules: ['Stay passive until an operator approves.'],
    toolsetId: 'fleet.hermes.balanced',
  },
  kind: 'agentic-coding-harness-contract',
  label: 'Harness / security and orchestration contract',
  mode: 'passive',
  objective: 'Converge Code Buddy and Cowork around a shared harness.',
  safetyNotes: ['This contract is display-only; it cannot approve or execute.'],
  schemaVersion: 1,
};

describe('AgenticHarnessStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = '';
  });

  it('parses direct and workspace-wrapped harness artifacts', () => {
    expect(parseAgenticHarnessArtifact(JSON.stringify(harness))).toEqual(harness);
    expect(
      parseAgenticHarnessArtifact(
        JSON.stringify({
          harness,
          kind: 'agentic-coding-proposal-loop-cowork-workspace',
        })
      )
    ).toEqual(harness);
    expect(parseAgenticHarnessArtifact('{not-json')).toBeNull();
  });

  it('summarizes terms, surfaces, and blocking lifecycle hooks', () => {
    expect(summarizeAgenticHarness(harness)).toEqual({
      blockingStageCount: 2,
      lifecycleStageCount: 3,
      nativeSurfaceCount: 2,
      termCount: 7,
    });
  });

  it('renders passive authority boundaries and seeds a review goal', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(AgenticHarnessStrip, {
          harness,
          onUseAsGoal,
          sourceKind: 'workspace json',
        })
      );
    });

    const strip = target.querySelector('[data-testid="agentic-harness-strip"]');
    expect(strip?.textContent).toContain('Harness / security and orchestration contract');
    expect(strip?.textContent).toContain('workspace json');
    expect(strip?.textContent).toContain('passive');
    expect(strip?.textContent).toContain('display_only');
    expect(strip?.textContent).toContain('no execution');
    expect(strip?.textContent).toContain('Status: needs_review');
    expect(strip?.textContent).toContain('Supervision: human_review_required');
    expect(strip?.textContent).toContain('Approval: needs_approval');
    expect(strip?.textContent).toContain('7 terms');
    expect(strip?.textContent).toContain('3 hooks');
    expect(strip?.textContent).toContain('2 blocking');
    expect(strip?.textContent).toContain('fleet.hermes.balanced');
    expect(strip?.textContent).toContain('Run');
    expect(strip?.textContent).toContain('Evidence');
    expect(strip?.textContent).toContain('before_tool_call');
    expect(strip?.textContent).toContain('Tools');
    expect(strip?.textContent).toContain('This contract is display-only');

    const button = target.querySelector('button');
    expect(button?.textContent).toContain('Use as Fleet goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    expect(onUseAsGoal.mock.calls[0]?.[0]).toBe(buildAgenticHarnessGoal(harness));
    expect(onUseAsGoal.mock.calls[0]?.[0]).toContain('Keep this passive');
  });
});
