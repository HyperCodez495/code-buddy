/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilePreviewPane } from '../src/renderer/components/FilePreviewPane';
import { useAppStore } from '../src/renderer/store';
import type { AgenticHarnessContract } from '../src/renderer/components/agentic-harness-strip';

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
    readyCommandCount: 1,
    supervisionState: 'human_review_required',
    workspaceStatus: 'needs_review',
  },
  canExecute: false,
  contractTerms: [
    { id: 'run', label: 'Run', safetyNote: 'Bounded run only.' },
    { id: 'evidence', label: 'Evidence', safetyNote: 'Proof required.' },
  ],
  executionMode: 'display_only',
  hermes: {
    agentId: 'hermes',
    lifecycleStages: [
      { blocksOperation: true, label: 'Before tool call', stage: 'before_tool_call' },
    ],
    nativeSurfaces: [{ id: 'tools', label: 'Tools' }],
    toolsetId: 'fleet.hermes.balanced',
  },
  kind: 'agentic-coding-harness-contract',
  label: 'Harness / security and orchestration contract',
  mode: 'passive',
  safetyNotes: ['Display-only from file preview.'],
  schemaVersion: 1,
};

function installPreviewApi(source: string) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      preview: {
        get: vi.fn(async () => ({
          kind: 'text',
          language: 'json',
          lineCount: source.split('\n').length,
          mime: 'application/json',
          name: 'agentic-coding-workspace.json',
          path: 'D:/tmp/agentic-coding-workspace.json',
          size: source.length,
          text: source,
        })),
      },
    },
  });
}

async function flushPreview() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('FilePreviewPane agentic harness preview', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    useAppStore.getState().setPreviewFilePath(null);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders a Cowork workspace JSON harness as a passive contract view', async () => {
    const source = JSON.stringify({
      harness,
      kind: 'agentic-coding-proposal-loop-cowork-workspace',
    });
    installPreviewApi(source);
    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      useAppStore.getState().setPreviewFilePath('D:/tmp/agentic-coding-workspace.json');
      root?.render(React.createElement(FilePreviewPane, { inline: true }));
    });
    await flushPreview();

    expect(target.querySelector('[data-testid="agentic-harness-strip"]')).not.toBeNull();
    expect(target.textContent).toContain('Harness / security and orchestration contract');
    expect(target.textContent).toContain('agentic-coding-workspace.json');
    expect(target.textContent).toContain('passive');
    expect(target.textContent).toContain('display_only');
    expect(target.textContent).toContain('no execution');
    expect(target.textContent).toContain('fleet.hermes.balanced');
    expect(target.textContent).not.toContain('"contractTerms"');
  });
});
