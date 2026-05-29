import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserOperatorExecutor } from '../../src/browser-automation/browser-operator-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      init = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      page = {
        content: vi.fn().mockResolvedValue('<html><body>normal page</body></html>'),
        goto: vi.fn().mockResolvedValue(undefined),
        act: vi.fn().mockResolvedValue(undefined),
      };
    },
  };
});

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    default: {
      ...original,
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('Browser Operator Consent Gate', () => {
  let sessionDraft: BrowserOperatorSessionDraft;
  let confirmSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');

    sessionDraft = {
      sessionId: 'test-session-123',
      query: 'https://example.com',
      goal: 'Test consent gate',
      mode: 'isolated',
      consent: {
        required: true,
        granted: true, // Initial session level consent is granted
        scopes: ['browser_interaction'], // required field consumed by buildBrowserOperatorHarnessBundle (scopes.join)
        reason: 'Test consent gate',
      },
      actionLog: [
        {
          id: 'step-1',
          sequence: 1,
          title: 'Navigate to site',
          tool: 'navigate',
          inputs: { url: 'https://example.com' },
          status: 'pending',
        },
        {
          id: 'step-2',
          sequence: 2,
          title: 'Click login button',
          tool: 'click',
          inputs: { ref: 42 },
          status: 'pending',
        },
      ],
      stopControl: {
        stopConditions: [],
      },
    };
  });

  it('navigates without prompting, but click prompts for confirmation', async () => {
    // Mock user approving click action
    confirmSpy.mockResolvedValue({ confirmed: true });

    const executor = new BrowserOperatorExecutor(sessionDraft);
    const result = await executor.execute();

    expect(result.success).toBe(true);

    // Check that requestConfirmation was called EXACTLY once (for the 'click' tool)
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith({
      operation: 'browser_write',
      filename: 'click',
      content: 'Execute browser action: click on element 42',
    });
  });

  it('stops execution and throws error if operator rejects consent for click', async () => {
    // Mock user rejecting click action
    confirmSpy.mockResolvedValue({ confirmed: false });

    const executor = new BrowserOperatorExecutor(sessionDraft);

    await expect(executor.execute()).rejects.toThrow('BrowserOperatorConsentDenied');

    // Confirm execution status updated correctly on the second step
    expect(sessionDraft.actionLog[0]?.status).toBe('completed'); // navigate worked
    expect(sessionDraft.actionLog[1]?.status).toBe('stopped'); // click stopped
    expect(sessionDraft.actionLog[1]?.evidence).toBe('Consent denied by operator.');
  });
});
