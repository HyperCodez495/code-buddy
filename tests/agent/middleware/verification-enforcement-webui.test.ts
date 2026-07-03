/**
 * Web-UI verification latch — UI code changed without any browser-based
 * check must trigger the develop → launch → browse → verify nudge, once
 * per task, independently of the generic ≥3-files latch.
 */
import { describe, expect, it } from 'vitest';

import {
  VerificationEnforcementMiddleware,
  isWebUiFile,
} from '../../../src/agent/middleware/verification-enforcement.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';
import type { ChatEntry } from '../../../src/agent/types.js';

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  const state = new Map<string, unknown>();
  return {
    toolRound: 5,
    maxToolRounds: 50,
    sessionCost: 0.1,
    sessionCostLimit: 10,
    inputTokens: 1000,
    outputTokens: 500,
    history: [],
    messages: [],
    isStreaming: false,
    state,
    getState<T>(key: string): T | undefined { return state.get(key) as T | undefined; },
    setState<T>(key: string, value: T): void { state.set(key, value); },
    ...overrides,
  };
}

function toolEntry(name: string, args: Record<string, unknown> = {}): ChatEntry {
  return {
    type: 'tool_result',
    content: 'ok',
    timestamp: new Date(),
    toolCall: {
      id: `call-${Math.random()}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    },
  };
}

describe('web-UI verification latch', () => {
  it('nudges the browser loop when a single UI file changed and no browser tool ran', async () => {
    const mw = new VerificationEnforcementMiddleware();
    const context = makeContext({
      history: [toolEntry('write_file', { path: 'src/components/LoginForm.tsx' })],
    });
    const result = await mw.afterTurn(context);
    expect(result.action).toBe('warn');
    expect(result.message).toContain('web_test');
    expect(result.message).toContain('app_server');
  });

  it('stays quiet when web_test already ran, and for non-UI files', async () => {
    const mw = new VerificationEnforcementMiddleware();

    const verified = makeContext({
      history: [
        toolEntry('write_file', { path: 'src/components/LoginForm.tsx' }),
        toolEntry('web_test', { url: 'http://127.0.0.1:5173/' }),
      ],
    });
    expect((await mw.afterTurn(verified)).action).toBe('continue');

    const backend = makeContext({
      history: [toolEntry('write_file', { path: 'src/server/router.ts' })],
    });
    expect((await mw.afterTurn(backend)).action).toBe('continue');
  });

  it('warns once per task and re-arms on reset()', async () => {
    const mw = new VerificationEnforcementMiddleware();
    const context = makeContext({
      history: [toolEntry('str_replace_editor', { path: 'cowork/src/renderer/App.tsx' })],
    });
    expect((await mw.afterTurn(context)).action).toBe('warn');
    expect((await mw.afterTurn(context)).action).toBe('continue');
    mw.reset();
    expect((await mw.afterTurn(context)).action).toBe('warn');
  });

  it('the generic ≥3-files latch still fires independently after the web nudge', async () => {
    const mw = new VerificationEnforcementMiddleware();
    const uiOnly = makeContext({
      history: [toolEntry('write_file', { path: 'src/components/A.tsx' })],
    });
    expect((await mw.afterTurn(uiOnly)).action).toBe('warn');

    const manyBackendFiles = makeContext({
      history: [
        toolEntry('write_file', { path: 'src/a.rs' }),
        toolEntry('write_file', { path: 'src/b.rs' }),
        toolEntry('write_file', { path: 'src/c.rs' }),
      ],
    });
    const result = await mw.afterTurn(manyBackendFiles);
    expect(result.action).toBe('warn');
    expect(result.message).toContain('task_verify');
  });

  it('isWebUiFile classifies extensions and UI directories', () => {
    expect(isWebUiFile('src/components/Button.tsx')).toBe(true);
    expect(isWebUiFile('app/styles/main.scss')).toBe(true);
    expect(isWebUiFile('index.html')).toBe(true);
    expect(isWebUiFile('cowork/src/renderer/util.ts')).toBe(true);
    expect(isWebUiFile('src/pages/home.js')).toBe(true);
    expect(isWebUiFile('src/server/router.ts')).toBe(false);
    expect(isWebUiFile('README.md')).toBe(false);
    expect(isWebUiFile('src/tools/weather.ts')).toBe(false);
  });
});
