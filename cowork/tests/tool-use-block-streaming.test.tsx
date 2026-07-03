/**
 * @vitest-environment happy-dom
 *
 * Streaming tool output — the ToolUseBlock card must show the live
 * tool_stream output while the tool runs (last line in the collapsed
 * header, full stream when expanded) instead of a bare spinner, and the
 * store must ACCUMULATE toolOutputDelta chunks (a plain spread kept only
 * the last chunk).
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAppStore } from '../src/renderer/store';
import { ToolUseBlock } from '../src/renderer/components/message/ToolUseBlock';
import type { Message, ToolUseContent, TraceStep } from '../src/renderer/types';

const SESSION_ID = 'stream-test-session';

function seedRunningToolStep(step: Partial<TraceStep> & { id: string }): void {
  useAppStore.getState().addTraceStep(SESSION_ID, {
    type: 'tool_call',
    status: 'running',
    title: step.id,
    timestamp: Date.now(),
    ...step,
  } as TraceStep);
  useAppStore.setState((state) => ({
    sessionStates: {
      ...state.sessionStates,
      [SESSION_ID]: {
        ...state.sessionStates[SESSION_ID],
        activeTurn: { stepId: 'turn-1', userMessageId: 'u1' },
      },
    },
  }));
}

describe('tool output streaming', () => {
  beforeEach(() => {
    useAppStore.setState((state) => {
      const sessionStates = { ...state.sessionStates };
      delete sessionStates[SESSION_ID];
      return { sessionStates };
    });
  });

  describe('store: updateTraceStep with toolOutputDelta', () => {
    it('accumulates deltas instead of keeping only the last chunk', () => {
      seedRunningToolStep({ id: 'tool-1' });
      const store = useAppStore.getState();
      store.updateTraceStep(SESSION_ID, 'tool-1', { toolOutputDelta: 'chunk one\n' });
      store.updateTraceStep(SESSION_ID, 'tool-1', { toolOutputDelta: 'chunk two\n' });

      const step = useAppStore.getState().sessionStates[SESSION_ID]!.traceSteps
        .find((s) => s.id === 'tool-1')!;
      expect(step.toolOutput).toBe('chunk one\nchunk two\n');
      // The delta is an instruction, never persisted state.
      expect(step.toolOutputDelta).toBeUndefined();
    });

    it('a plain toolOutput update (tool_end) replaces the accumulated stream', () => {
      seedRunningToolStep({ id: 'tool-2' });
      const store = useAppStore.getState();
      store.updateTraceStep(SESSION_ID, 'tool-2', { toolOutputDelta: 'partial…' });
      store.updateTraceStep(SESSION_ID, 'tool-2', { toolOutput: 'final full output', status: 'completed' });

      const step = useAppStore.getState().sessionStates[SESSION_ID]!.traceSteps
        .find((s) => s.id === 'tool-2')!;
      expect(step.toolOutput).toBe('final full output');
    });

    it('caps the accumulated stream to a tail instead of growing unbounded', () => {
      seedRunningToolStep({ id: 'tool-3' });
      const store = useAppStore.getState();
      store.updateTraceStep(SESSION_ID, 'tool-3', { toolOutputDelta: 'HEAD-'.padEnd(90_000, 'x') });
      store.updateTraceStep(SESSION_ID, 'tool-3', { toolOutputDelta: 'y'.repeat(20_000) + 'TAIL' });

      const step = useAppStore.getState().sessionStates[SESSION_ID]!.traceSteps
        .find((s) => s.id === 'tool-3')!;
      expect(step.toolOutput!.length).toBeLessThanOrEqual(100_000);
      expect(step.toolOutput!.endsWith('TAIL')).toBe(true);
      expect(step.toolOutput!.startsWith('HEAD-')).toBe(false);
    });
  });

  describe('ToolUseBlock card', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    function renderCard(): void {
      const block: ToolUseContent = {
        type: 'tool_use',
        id: 'tool-1',
        name: 'bash',
        input: { command: 'npm test' },
      };
      const message = {
        id: 'm1',
        role: 'assistant',
        content: [block],
        sessionId: SESSION_ID,
      } as unknown as Message;
      act(() => {
        root.render(<ToolUseBlock block={block} message={message} />);
      });
    }

    it('shows the last streamed line in the collapsed header while running', () => {
      seedRunningToolStep({ id: 'tool-1' });
      act(() => {
        useAppStore.getState().updateTraceStep(SESSION_ID, 'tool-1', {
          toolOutputDelta: 'installing deps\nrunning suite 3/12\n',
        });
      });
      renderCard();
      expect(container.textContent).toContain('running suite 3/12');
      expect(container.textContent).not.toContain('installing deps');
    });

    it('shows the full stream in the expanded Output (streaming…) section', () => {
      seedRunningToolStep({ id: 'tool-1' });
      act(() => {
        useAppStore.getState().updateTraceStep(SESSION_ID, 'tool-1', {
          toolOutputDelta: 'line alpha\nline beta\n',
        });
      });
      renderCard();
      const header = container.querySelector('button')!;
      act(() => {
        header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.textContent).toContain('Output (streaming');
      expect(container.textContent).toContain('line alpha');
      expect(container.textContent).toContain('line beta');
    });
  });
});
