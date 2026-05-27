import { describe, expect, it, afterEach } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { MCPManager } from '../../src/mcp/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, '../fixtures/real-mcp-fixture.mjs');

describe('MCPManager real stdio fixture', () => {
  let manager: MCPManager | null = null;

  afterEach(async () => {
    await manager?.dispose();
    manager = null;
  });

  it('discovers and invokes tools through a real MCP stdio server', async () => {
    manager = new MCPManager();

    await manager.addServer({
      name: 'qa_fixture',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [fixturePath],
      },
    });

    expect(manager.getServerStatus('qa_fixture')).toBe('connected');
    expect(manager.getTransportType('qa_fixture')).toBe('stdio');

    const tools = manager.getTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['mcp__qa_fixture__echo_marker', 'mcp__qa_fixture__sum_pair'])
    );

    const echo = await manager.callTool('mcp__qa_fixture__echo_marker', {
      message: 'OK',
    });
    expect(echo.content).toEqual([{ type: 'text', text: 'MCP_REAL_FIXTURE:OK' }]);

    const sum = await manager.callTool('mcp__qa_fixture__sum_pair', {
      left: 20,
      right: 22,
    });
    expect(sum.content).toEqual([{ type: 'text', text: 'MCP_SUM:42' }]);

    await manager.removeServer('qa_fixture');
    expect(manager.getServerStatus('qa_fixture')).toBe('disconnected');
    expect(manager.getTools()).toHaveLength(0);
  }, 15_000);
});
