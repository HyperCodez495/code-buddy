/**
 * S3 regression: if the SSRF guard module itself cannot be loaded, navigation
 * must FAIL CLOSED (refuse), not proceed unchecked. The previous call site caught
 * the dynamic-import error and proceeded, so a broken/renamed guard module would
 * silently disable SSRF protection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigateSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/browser-automation/browser-manager.js', () => ({
  getBrowserManager: () => ({
    navigate: navigateSpy,
    getTitle: vi.fn().mockResolvedValue('Title'),
  }),
  BrowserManager: class {},
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Simulate the guard module being unloadable: the factory throws, so the dynamic
// `import('../security/ssrf-guard.js')` inside guardNavigationUrl rejects.
vi.mock('../../src/security/ssrf-guard.js', () => {
  throw new Error('ssrf-guard module unavailable (test)');
});

import { BrowserTool } from '../../src/browser-automation/browser-tool.js';

describe('navigate fails closed when the SSRF guard is unavailable (S3)', () => {
  beforeEach(() => navigateSpy.mockClear());

  it('refuses a normal public URL rather than navigating unchecked', async () => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url: 'http://1.1.1.1/' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/guard unavailable/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('still allows the inert about:blank (no guard needed)', async () => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url: 'about:blank' });
    expect(r.success).toBe(true);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });
});
