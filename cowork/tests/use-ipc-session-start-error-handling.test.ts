import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC session start error handling', () => {
  it('contains the session start failure inside the hook after showing a global notice', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('id: `notice-session-start-${Date.now()}`');
    expect(source).toContain(
      "message: e instanceof Error ? e.message : i18n.t('chat.startFailed')"
    );
    expect(source).not.toContain('throw e;');
  });

  it('clears the active turn when a session-scoped backend error arrives', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');
    const errorCase = source.match(/case 'error':[\s\S]*?break;/)?.[0] || '';

    expect(errorCase).toContain('event.payload.sessionId');
    expect(errorCase).toContain("store.updateSession(event.payload.sessionId, { status: 'idle' })");
    expect(errorCase).toContain('store.finishExecutionClock(event.payload.sessionId)');
    expect(errorCase).toContain('store.clearActiveTurn(event.payload.sessionId)');
    expect(errorCase).toContain('store.clearPendingTurns(event.payload.sessionId)');
    expect(errorCase).toContain('store.clearQueuedMessages(event.payload.sessionId)');
  });
});
