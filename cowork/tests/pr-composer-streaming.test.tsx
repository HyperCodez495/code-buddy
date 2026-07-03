/**
 * @vitest-environment happy-dom
 *
 * PRComposer streams the live agent draft (lint fix → PR body) instead of a
 * bare "Opening PR…" spinner: a phase label plus the tail of the session's
 * partialMessage while the command runs.
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
import { PRComposer } from '../src/renderer/components/PRComposer';

const SESSION_ID = 'pr-session';

describe('PRComposer live draft streaming', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveExecute: (v: unknown) => void;

  beforeEach(() => {
    // Seed a session so partialMessage has a home.
    useAppStore.setState((state) => ({
      activeSessionId: SESSION_ID,
      sessionStates: {
        ...state.sessionStates,
        [SESSION_ID]: {
          ...(state.sessionStates[SESSION_ID] ?? {}),
          messages: [],
          traceSteps: [],
          partialMessage: '',
          partialThinking: '',
          activeTurn: null,
          pendingTurns: [],
        } as never,
      },
    }));
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

  it('shows the streamed draft tail and a phase label while running', async () => {
    // runLint defaults to true → first phase is lint.
    act(() => {
      root.render(<PRComposer onClose={() => {}} />);
    });

    const submit = container.querySelector('[data-testid="pr-submit"]') as HTMLButtonElement;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Agent streams its work onto the session partialMessage.
    act(() => {
      useAppStore.getState().setPartialMessage(SESSION_ID, 'Refactored auth guard; drafting PR body…');
    });

    const stream = container.querySelector('[data-testid="pr-draft-stream"]')!;
    expect(stream).toBeTruthy();
    expect(stream.textContent).toContain('drafting PR body');
    // Phase label reflects the lint pre-pass.
    expect(stream.textContent).toContain('Running /lint fix');
    expect(submit.textContent).toContain('lint');

    await act(async () => {
      resolveExecute({});
    });
  });
});
