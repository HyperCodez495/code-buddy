import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createFeishuTools } from '../../src/tools/registry/feishu-tools.js';
import type { ITool } from '../../src/tools/registry/types.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  userAgent?: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes Feishu real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleFeishuRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('fetches a tenant token and reads document raw content over real HTTP', async () => {
    const tool = getTool('feishu_doc_read', createFeishuTools({
      appId: 'app-id',
      appSecret: 'app-secret',
      baseUrl,
      userAgent: 'Code-Buddy-Test/1.0',
    }));

    const result = await tool.execute({ doc_token: 'doc-token' });

    expect(result.success, result.error).toBe(true);
    expect(JSON.parse(result.output as string)).toMatchObject({
      success: true,
      provider: 'feishu',
      credential_source: 'app_credentials_option',
      tool: 'feishu_doc_read',
      endpoint: '/open-apis/docx/v1/documents/doc-token/raw_content',
      content: 'Real document text from Feishu.',
      data: {
        content: 'Real document text from Feishu.',
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      userAgent: 'Code-Buddy-Test/1.0',
      body: {
        app_id: 'app-id',
        app_secret: 'app-secret',
      },
    });
    expect(requests[1]).toMatchObject({
      method: 'GET',
      path: '/open-apis/docx/v1/documents/doc-token/raw_content',
      authorization: 'Bearer tenant-token',
      userAgent: 'Code-Buddy-Test/1.0',
    });
  });

  it('lists and writes drive comments using direct access tokens over real HTTP', async () => {
    const tools = createFeishuTools({
      accessToken: 'direct-token',
      baseUrl,
      userAgent: 'Code-Buddy-Test/2.0',
    });

    const listComments = await getTool('feishu_drive_list_comments', tools).execute({
      file_token: 'file-token',
      file_type: 'docx',
      is_whole: true,
      page_size: 50,
      page_token: 'next-page',
    });
    const listReplies = await getTool('feishu_drive_list_comment_replies', tools).execute({
      file_token: 'file-token',
      comment_id: 'comment-id',
      page_size: 25,
    });
    const reply = await getTool('feishu_drive_reply_comment', tools).execute({
      file_token: 'file-token',
      comment_id: 'comment-id',
      content: 'Thanks, I will update this section.',
    });
    const add = await getTool('feishu_drive_add_comment', tools).execute({
      file_token: 'file-token',
      content: 'Please review the whole document.',
      file_type: 'docx',
    });

    expect(listComments.success, listComments.error).toBe(true);
    expect(listReplies.success, listReplies.error).toBe(true);
    expect(reply.success, reply.error).toBe(true);
    expect(add.success, add.error).toBe(true);
    expect(JSON.parse(listComments.output as string)).toMatchObject({
      tool: 'feishu_drive_list_comments',
      credential_source: 'option',
      data: {
        items: [{ comment_id: 'comment-id', content: 'Comment body' }],
        has_more: false,
      },
    });
    expect(JSON.parse(listReplies.output as string)).toMatchObject({
      tool: 'feishu_drive_list_comment_replies',
      data: {
        items: [{ reply_id: 'reply-id', content: 'Reply body' }],
      },
    });
    expect(JSON.parse(reply.output as string)).toMatchObject({
      tool: 'feishu_drive_reply_comment',
      data: {
        reply_id: 'new-reply',
      },
    });
    expect(JSON.parse(add.output as string)).toMatchObject({
      tool: 'feishu_drive_add_comment',
      data: {
        comment_id: 'new-comment',
      },
    });

    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      path: '/open-apis/drive/v1/files/file-token/comments?file_type=docx&user_id_type=open_id&page_size=50&is_whole=true&page_token=next-page',
      authorization: 'Bearer direct-token',
    });
    expect(requests[1]).toMatchObject({
      method: 'GET',
      path: '/open-apis/drive/v1/files/file-token/comments/comment-id/replies?file_type=docx&user_id_type=open_id&page_size=25',
      authorization: 'Bearer direct-token',
    });
    expect(requests[2]).toMatchObject({
      method: 'POST',
      path: '/open-apis/drive/v1/files/file-token/comments/comment-id/replies?file_type=docx',
      body: {
        content: {
          elements: [
            {
              type: 'text_run',
              text_run: { text: 'Thanks, I will update this section.' },
            },
          ],
        },
      },
    });
    expect(requests[3]).toMatchObject({
      method: 'POST',
      path: '/open-apis/drive/v1/files/file-token/new_comments',
      body: {
        file_type: 'docx',
        reply_elements: [
          {
            type: 'text',
            text: 'Please review the whole document.',
          },
        ],
      },
    });
  });

  it('fails fast on invalid input before any network call', async () => {
    const tool = getTool('feishu_drive_list_comments', createFeishuTools({
      accessToken: 'direct-token',
      baseUrl,
    }));

    const missingFile = await tool.execute({});
    expect(missingFile.success).toBe(false);
    expect(missingFile.error).toBe('file_token is required');

    const badPageSize = await tool.execute({ file_token: 'file-token', page_size: 101 });
    expect(badPageSize.success).toBe(false);
    expect(badPageSize.error).toBe('page_size must be an integer from 1 to 100');
    expect(requests).toHaveLength(0);
  });

  it('marks the official Hermes Feishu tools as exact local parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T23:40:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'feishu_doc_read',
        status: 'exact',
        detectedCodeBuddyTools: ['feishu_doc_read'],
      }),
      expect.objectContaining({
        name: 'feishu_drive_add_comment',
        status: 'exact',
        detectedCodeBuddyTools: ['feishu_drive_add_comment'],
      }),
      expect.objectContaining({
        name: 'feishu_drive_list_comments',
        status: 'exact',
        detectedCodeBuddyTools: ['feishu_drive_list_comments'],
      }),
    ]));
  });
});

async function handleFeishuRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as Record<string, unknown> : {};
  const path = req.url ?? '/';
  requests.push({
    method: req.method ?? 'GET',
    path,
    authorization: req.headers.authorization,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    body: parsedBody,
  });

  if (path === '/open-apis/auth/v3/tenant_access_token/internal') {
    writeJson(res, 200, { code: 0, msg: 'ok', tenant_access_token: 'tenant-token' });
    return;
  }
  if (path === '/open-apis/docx/v1/documents/doc-token/raw_content') {
    requireAuth(req, res);
    writeJson(res, 200, { code: 0, msg: 'ok', data: { content: 'Real document text from Feishu.' } });
    return;
  }
  if (path.startsWith('/open-apis/drive/v1/files/file-token/comments?')) {
    requireAuth(req, res);
    writeJson(res, 200, {
      code: 0,
      msg: 'ok',
      data: {
        items: [{ comment_id: 'comment-id', content: 'Comment body' }],
        has_more: false,
      },
    });
    return;
  }
  if (path.startsWith('/open-apis/drive/v1/files/file-token/comments/comment-id/replies?') && req.method === 'GET') {
    requireAuth(req, res);
    writeJson(res, 200, {
      code: 0,
      msg: 'ok',
      data: {
        items: [{ reply_id: 'reply-id', content: 'Reply body' }],
      },
    });
    return;
  }
  if (path === '/open-apis/drive/v1/files/file-token/comments/comment-id/replies?file_type=docx' && req.method === 'POST') {
    requireAuth(req, res);
    writeJson(res, 200, { code: 0, msg: 'ok', data: { reply_id: 'new-reply' } });
    return;
  }
  if (path === '/open-apis/drive/v1/files/file-token/new_comments' && req.method === 'POST') {
    requireAuth(req, res);
    writeJson(res, 200, { code: 0, msg: 'ok', data: { comment_id: 'new-comment' } });
    return;
  }
  writeJson(res, 404, { code: 404, msg: `Unhandled test path: ${path}` });
}

function getTool(name: string, tools: ITool[]): ITool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing test tool: ${name}`);
  }
  return tool;
}

function requireAuth(req: IncomingMessage, res: ServerResponse): void {
  if (!req.headers.authorization) {
    writeJson(res, 401, { code: 99991663, msg: 'missing authorization' });
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.writableEnded) {
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
