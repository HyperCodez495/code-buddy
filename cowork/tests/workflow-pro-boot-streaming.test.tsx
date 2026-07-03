/**
 * @vitest-environment happy-dom
 *
 * WorkflowProPanel streams the server boot log while starting instead of a
 * blind "Starting…" spinner: it polls workflowBuilder.logs() during the
 * pending start() and renders the lines.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowProPanel } from '../src/renderer/components/WorkflowProPanel';

describe('WorkflowProPanel boot log streaming', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveStart: (v: unknown) => void;
  let logLines: string[];

  beforeEach(() => {
    logLines = [];
    resolveStart = () => {};
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      workflowBuilder: {
        status: vi.fn(async () => ({ running: false, port: 8080 })),
        start: vi.fn(() => new Promise((resolve) => { resolveStart = resolve; })),
        stop: vi.fn(async () => ({ success: true })),
        logs: vi.fn(async () => ({ lines: logLines })),
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('polls and renders boot log lines while the server starts', async () => {
    vi.useFakeTimers();
    act(() => {
      root.render(<WorkflowProPanel />);
    });

    // Click "Start Server" — start() stays pending (loading = true).
    const startBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start Server')
    )!;
    expect(startBtn).toBeTruthy();
    await act(async () => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Server produces boot lines; the poll interval fires.
    logLines = ['Starting WorkflowBuilder (npm run dev)…', 'vite v5 building…', 'Local: http://localhost:8080'];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    const panel = container.querySelector('[data-testid="workflow-boot-log"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('vite v5 building');
    expect(panel!.textContent).toContain('Local: http://localhost:8080');

    // Settle the pending start so cleanup is clean.
    await act(async () => {
      resolveStart({ success: true });
    });
  });
});
