/**
 * @vitest-environment happy-dom
 *
 * BatchExecutionDialog streams live sub-agent activity while the batch runs
 * instead of showing only a "Launching…" spinner. The batch decomposes into
 * sub-agents (subagent.* events → store.subAgents); the dialog must render
 * them while the command.execute promise is still pending.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', changeLanguage: vi.fn() },
    t: (key: string, fb?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template = typeof fb === 'string' ? fb : key;
      const options = typeof fb === 'object' ? fb : opts;
      return Object.entries(options ?? {}).reduce(
        (v, [k, val]) => v.replaceAll(`{{${k}}}`, String(val)),
        template
      );
    },
  }),
}));

import { useAppStore } from '../src/renderer/store';
import { BatchExecutionDialog } from '../src/renderer/components/BatchExecutionDialog';
import type { SubAgent } from '../src/renderer/types';

const SESSION_ID = 'batch-session';

function subAgent(over: Partial<SubAgent> & { id: string; nickname: string }): SubAgent {
  return {
    role: 'worker',
    status: 'running',
    depth: 1,
    parentId: null,
    createdAt: Date.now(),
    ...over,
  };
}

describe('BatchExecutionDialog live sub-agent activity', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveExecute: (v: unknown) => void;

  beforeEach(() => {
    useAppStore.setState({ activeSessionId: SESSION_ID, subAgents: {} });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      command: {
        execute: vi.fn(
          () => new Promise((resolve) => {
            resolveExecute = resolve;
          })
        ),
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders sub-agents with their current step while the batch is running', async () => {
    act(() => {
      root.render(<BatchExecutionDialog onClose={() => {}} />);
    });

    // Type a goal and launch — command.execute stays pending (running state).
    // React tracks the controlled value via a property descriptor, so set it
    // through the native setter before dispatching the input event.
    const textarea = container.querySelector('[data-testid="batch-goal"]') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    act(() => {
      nativeSetter.call(textarea, 'Audit all components');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = container.querySelector('[data-testid="batch-submit"]') as HTMLButtonElement;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The batch spawns sub-agents that stream activity into the store.
    act(() => {
      useAppStore.getState().addSubAgent(SESSION_ID, subAgent({ id: 'a1', nickname: 'Scout' }));
      useAppStore.getState().addSubAgent(SESSION_ID, subAgent({ id: 'a2', nickname: 'Auditor' }));
      useAppStore.getState().setSubAgentActivity(SESSION_ID, 'a1', 'scanning Button.tsx');
      useAppStore.getState().completeSubAgent(SESSION_ID, 'a2', 'done');
    });

    const panel = container.querySelector('[data-testid="batch-subagents"]')!;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Scout');
    expect(panel.textContent).toContain('scanning Button.tsx');
    expect(panel.textContent).toContain('Auditor');
    // Button label reflects the live count.
    expect(submit.textContent).toContain('2 sub-agents running');

    // Cleanup: let the pending promise settle.
    await act(async () => {
      resolveExecute({});
    });
  });
});
