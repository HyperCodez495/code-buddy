import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'code-buddy-qa-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.tool(
  'echo_marker',
  'Echo a deterministic QA marker through a real MCP stdio transport.',
  {
    message: z.string(),
  },
  async ({ message }) => ({
    content: [
      {
        type: 'text',
        text: `MCP_REAL_FIXTURE:${message}`,
      },
    ],
  })
);

server.tool(
  'sum_pair',
  'Add two numbers through a real MCP stdio transport.',
  {
    left: z.number(),
    right: z.number(),
  },
  async ({ left, right }) => ({
    content: [
      {
        type: 'text',
        text: `MCP_SUM:${left + right}`,
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
