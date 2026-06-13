import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerDesktopTools, desktopControlEnabled } from '../../src/mcp/mcp-desktop-tools.js';

// Minimal fake McpServer capturing server.tool(name, desc, schema, handler).
type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
class FakeServer {
  tools = new Map<string, { description: string; schema: unknown; handler: Handler }>();
  tool(name: string, description: string, schema: unknown, handler: Handler): void {
    this.tools.set(name, { description, schema, handler });
  }
}

const CONTROL_TOOLS = ['desktop_click', 'desktop_move_mouse', 'desktop_type', 'desktop_key'];
const READONLY_TOOLS = ['desktop_screenshot', 'desktop_snapshot'];

describe('registerDesktopTools — gating', () => {
  const prev = process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'];
  afterEach(() => {
    if (prev === undefined) delete process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'];
    else process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'] = prev;
  });

  it('always exposes read-only tools and HIDES control tools when the flag is unset', () => {
    delete process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'];
    expect(desktopControlEnabled()).toBe(false);
    const s = new FakeServer();
    registerDesktopTools(s as unknown as Parameters<typeof registerDesktopTools>[0]);
    for (const t of READONLY_TOOLS) expect(s.tools.has(t)).toBe(true);
    for (const t of CONTROL_TOOLS) expect(s.tools.has(t)).toBe(false);
  });

  it('exposes control tools only when CODEBUDDY_MCP_DESKTOP_CONTROL=1', () => {
    process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'] = '1';
    expect(desktopControlEnabled()).toBe(true);
    const s = new FakeServer();
    registerDesktopTools(s as unknown as Parameters<typeof registerDesktopTools>[0]);
    for (const t of [...READONLY_TOOLS, ...CONTROL_TOOLS]) expect(s.tools.has(t)).toBe(true);
  });
});

describe('desktop_snapshot handler — formatting', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('../../src/desktop-automation/smart-snapshot.js');
  });

  it('formats enumerated elements with refs, roles, labels and coordinates', async () => {
    vi.doMock('../../src/desktop-automation/smart-snapshot.js', () => ({
      getSmartSnapshotManager: () => ({
        takeSnapshot: async () => ({
          id: 's1',
          timestamp: new Date(0),
          source: 'Top Panel',
          screenSize: { width: 1920, height: 1080 },
          valid: true,
          ttl: 5000,
          elementMap: new Map(),
          elements: [
            {
              ref: 1,
              role: 'button',
              name: 'Chromium',
              bounds: { x: 30, y: 0, width: 28, height: 28 },
              center: { x: 44, y: 14 },
              interactive: true,
            },
          ],
        }),
      }),
    }));
    // Re-import after mocking so the handler's dynamic import resolves to the mock.
    const { registerDesktopTools: register } = await import('../../src/mcp/mcp-desktop-tools.js');
    const s = new FakeServer();
    register(s as unknown as Parameters<typeof register>[0]);
    const handler = s.tools.get('desktop_snapshot')!.handler;
    const res = await handler({});
    expect(res.isError).toBeFalsy();
    const text = res.content[0]!.text;
    expect(text).toContain('1 element(s) on "Top Panel" (1920x1080)');
    expect(text).toContain('[1] button "Chromium" (interactive) @ 44,14 [28x28]');
  });
});
