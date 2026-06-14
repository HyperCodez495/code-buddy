import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server';

// We override CodeBuddyMCPServer's start to use InMemoryTransport for the test
class TestMCPServer extends CodeBuddyMCPServer {
  public serverTransport: any;
  public clientTransport: any;

  async startInMemory() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.serverTransport = serverTransport;
    this.clientTransport = clientTransport;
    
    const mcpServer = (this as any).mcpServer;
    await mcpServer.connect(serverTransport);
    (this as any).running = true;
    (this as any).transport = serverTransport;
    
    return clientTransport;
  }
}

describe('Marketplace Roundtrip', () => {
  let mcpServer: TestMCPServer;
  let client: Client;

  beforeEach(async () => {
    mcpServer = new TestMCPServer();
    const clientTransport = await mcpServer.startInMemory();
    
    client = new Client({
      name: 'marketplace-client',
      version: '1.0.0',
    }, {
      capabilities: { tools: {} },
    });
    
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.stop();
  });

  it('should complete a full roundtrip for tool discovery and execution', async () => {
    // 1. Discover tools (Marketplace asks for what tools we provide)
    const { tools } = await client.listTools();
    
    // We should see the tools exposed by Code Buddy
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('list_files');
    expect(toolNames).toContain('bash');
    
    // 2. Execute a tool (Marketplace requests a tool execution)
    // We'll execute list_files against the current directory
    const result = await client.callTool({
      name: 'list_files',
      arguments: { path: __dirname },
    });

    // 3. Verify Result (Marketplace receives result)
    expect(result.content).toBeDefined();
    const resultText = (result.content as any)[0].text;
    expect(resultText).toContain('mcp-marketplace-roundtrip.test.ts');
    expect(result.isError).toBeFalsy();
  });
});
