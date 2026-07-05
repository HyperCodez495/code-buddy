import http from 'http';
import { describe, expect, it } from 'vitest';
import { HttpProbeTool } from '../../src/tools/http-probe-tool.js';

describe('HttpProbeTool', () => {
  it('probes loopback urls and refuses non-loopback urls', async () => {
    const server = http.createServer((_req, res) => { res.setHeader('x-test', 'yes'); res.end('hello'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing address');
      const ok = await new HttpProbeTool().execute({ url: `http://127.0.0.1:${address.port}/` });
      expect(ok.success).toBe(true);
      expect((ok.data as { status: number; size: number }).status).toBe(200);
      expect((ok.data as { status: number; size: number }).size).toBe(5);
      const denied = await new HttpProbeTool().execute({ url: 'https://example.com/' });
      expect(denied.success).toBe(false);
    } finally { server.close(); }
  });
});
