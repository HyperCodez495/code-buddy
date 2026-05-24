import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { BrowserOperatorExecutor } from '../../src/browser-automation/browser-operator-executor.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

const mockExecute = vi.fn();
const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('fake-png'));
const mockLaunch = vi.fn();
const mockClose = vi.fn();

vi.mock('../../src/browser-automation/browser-tool.js', () => ({
  getBrowserTool: () => ({
    execute: mockExecute,
  }),
}));

vi.mock('../../src/browser-automation/browser-manager.js', () => ({
  getBrowserManager: () => ({
    launch: mockLaunch,
    close: mockClose,
    screenshot: mockScreenshot,
  }),
}));

describe('BrowserOperatorExecutor', () => {
  let tempDir: string;
  let sampleDraft: BrowserOperatorSessionDraft;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-executor-'));
    
    sampleDraft = {
      schemaVersion: 1,
      sessionId: 'session-123',
      goal: 'test goal',
      mode: 'local',
      query: 'https://example.com',
      consent: {
        required: true,
        granted: false,
        scopes: ['local_browser'],
      },
      dedicatedTab: {
        required: true,
        reason: 'dedicated tab for testing',
      },
      stopControl: {
        enabled: true,
        label: 'Stop',
        stopConditions: ['success text', 'done'],
      },
      actionLog: [
        {
          id: 'action-1',
          sequence: 1,
          tool: 'navigate',
          title: 'Navigate to target',
          requiresConsent: true,
          status: 'planned',
          inputs: { url: 'https://example.com/target' },
        },
        {
          id: 'action-2',
          sequence: 2,
          tool: 'type',
          title: 'Type search query',
          requiresConsent: true,
          status: 'planned',
          inputs: { ref: 42, text: 'hello' },
        },
        {
          id: 'action-3',
          sequence: 3,
          tool: 'click',
          title: 'Click submit button',
          requiresConsent: true,
          status: 'planned',
          inputs: { ref: 123 },
        },
      ],
      proofExport: ['action log'],
    };

    mockExecute.mockReset();
    mockScreenshot.mockClear();
    mockLaunch.mockClear();
    mockClose.mockClear();
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('should block execution if consent is required but not granted', async () => {
    const executor = new BrowserOperatorExecutor(sampleDraft);
    await expect(executor.execute(tempDir)).rejects.toThrow(/consent/i);
  });

  it('should run successfully when consent is granted', async () => {
    mockExecute.mockResolvedValue({ success: true, output: 'Action completed' });

    const executor = new BrowserOperatorExecutor(sampleDraft);
    executor.grantConsent('test-operator');

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(true);
    expect(result.stopped).toBe(false);
    expect(mockLaunch).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();

    // Verify all actions completed
    expect(result.actionLog.every(a => a.status === 'completed')).toBe(true);

    // Verify correct calls to getBrowserTool().execute
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute).toHaveBeenNthCalledWith(1, { action: 'navigate', url: 'https://example.com/target' });
    expect(mockExecute).toHaveBeenNthCalledWith(2, { action: 'type', ref: 42, text: 'hello' });
    expect(mockExecute).toHaveBeenNthCalledWith(3, { action: 'click', ref: 123 });

    // Verify proof artifact was written
    const proofPath = path.join(tempDir, '.codebuddy', 'runs', 'session-123', 'artifacts', 'session-123.browser-operator.json');
    expect(await fs.pathExists(proofPath)).toBe(true);
    const proof = await fs.readJson(proofPath);
    expect(proof.success).toBe(true);
    expect(proof.consent.grantedBy).toBe('test-operator');
  });

  it('should stop mid-run if stop() is called', async () => {
    mockExecute.mockImplementation(async () => {
      executor.stop();
      return { success: true, output: 'Action completed' };
    });

    const executor = new BrowserOperatorExecutor(sampleDraft);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(false);
    expect(result.stopped).toBe(true);
    expect(result.actionLog[0]!.status).toBe('completed');
    expect(result.actionLog[1]!.status).toBe('stopped');
  });

  it('should stop and set status to stopped when a stop condition is met', async () => {
    mockExecute.mockResolvedValue({ success: true, output: 'Operation completed successfully. Found done!' });

    const executor = new BrowserOperatorExecutor(sampleDraft);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.stopped).toBe(true);
    expect(result.actionLog[0]!.status).toBe('stopped'); // Since first action output matched "done" (from "successfully. Found done!"), it stops immediately!
  });
});
