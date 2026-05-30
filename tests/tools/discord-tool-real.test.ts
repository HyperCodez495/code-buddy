import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createDiscordTools } from '../../src/tools/registry/discord-tools.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes discord real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleDiscordRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('fetches Discord messages through a real HTTP request', async () => {
    const [tool] = createDiscordTools({ token: 'test-discord-token', apiBaseUrl: baseUrl });

    const result = await tool!.execute({
      action: 'fetch_messages',
      channel_id: 'channel-123',
      limit: 2,
      before: '999',
    });

    expect(result.success, result.error).toBe(true);
    const payload = JSON.parse(result.output as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'discord_result',
      ok: true,
      action: 'fetch_messages',
      request: {
        method: 'GET',
        path: '/channels/channel-123/messages',
      },
    });
    expect(payload.data).toMatchObject({
      count: 1,
      messages: [
        {
          id: 'msg-1',
          content: 'real Discord payload',
          author: {
            id: 'user-1',
            username: 'patrice',
          },
        },
      ],
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/channels/channel-123/messages?limit=2&before=999',
      authorization: 'Bot test-discord-token',
    }));
  });

  it('searches members and creates threads through the same exact tool', async () => {
    const [tool] = createDiscordTools({ token: 'test-discord-token', apiBaseUrl: baseUrl });

    const search = await tool!.execute({
      action: 'search_members',
      guild_id: 'guild-1',
      query: 'pat',
      limit: 5,
    });
    expect(search.success, search.error).toBe(true);
    expect(JSON.parse(search.output as string)).toMatchObject({
      action: 'search_members',
      data: {
        count: 1,
        members: [
          {
            user_id: 'user-1',
            username: 'patrice',
            roles: ['role-1'],
          },
        ],
      },
    });

    const create = await tool!.execute({
      action: 'create_thread',
      channel_id: 'channel-123',
      name: 'Hermes parity thread',
      auto_archive_duration: 60,
    });
    expect(create.success, create.error).toBe(true);
    expect(JSON.parse(create.output as string)).toMatchObject({
      action: 'create_thread',
      data: {
        success: true,
        thread_id: 'thread-1',
        name: 'Hermes parity thread',
      },
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/guilds/guild-1/members/search?query=pat&limit=5',
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/channels/channel-123/threads',
      body: {
        name: 'Hermes parity thread',
        auto_archive_duration: 60,
        type: 11,
      },
    }));
  });

  it('runs Discord admin read and approved mutation actions through real HTTP requests', async () => {
    const [, adminTool] = createDiscordTools({ token: 'test-discord-token', apiBaseUrl: baseUrl });

    const guilds = await adminTool!.execute({ action: 'list_guilds' });
    expect(guilds.success, guilds.error).toBe(true);
    expect(JSON.parse(guilds.output as string)).toMatchObject({
      kind: 'discord_result',
      ok: true,
      action: 'list_guilds',
      data: {
        count: 1,
        guilds: [{ id: 'guild-1', name: 'Code Buddy Guild' }],
      },
    });

    const channels = await adminTool!.execute({ action: 'list_channels', guild_id: 'guild-1' });
    expect(channels.success, channels.error).toBe(true);
    expect(JSON.parse(channels.output as string)).toMatchObject({
      action: 'list_channels',
      data: {
        total_channels: 1,
        channels: expect.arrayContaining([
          expect.objectContaining({ id: 'channel-123', name: 'general', type: 'text' }),
        ]),
        channel_groups: [
          {
            category: { id: 'category-1', name: 'Engineering' },
            channels: [expect.objectContaining({ id: 'channel-123' })],
          },
        ],
      },
    });

    const denied = await adminTool!.execute({
      action: 'add_role',
      guild_id: 'guild-1',
      user_id: 'user-1',
      role_id: 'role-1',
    });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('requires approved_by');

    const approved = await adminTool!.execute({
      action: 'add_role',
      guild_id: 'guild-1',
      user_id: 'user-1',
      role_id: 'role-1',
      approved_by: 'real-test-reviewer',
    });
    expect(approved.success, approved.error).toBe(true);
    expect(JSON.parse(approved.output as string)).toMatchObject({
      action: 'add_role',
      data: {
        success: true,
        message: 'Role role-1 added to user user-1.',
      },
      request: {
        method: 'PUT',
        path: '/guilds/guild-1/members/user-1/roles/role-1',
      },
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/users/@me/guilds',
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/guilds/guild-1/channels',
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PUT',
      path: '/guilds/guild-1/members/user-1/roles/role-1',
      authorization: 'Bot test-discord-token',
    }));
  });

  it('marks official Hermes discord and discord_admin as exact local tool parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T19:45:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'discord',
      status: 'exact',
      detectedCodeBuddyTools: ['discord'],
    }));
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'discord_admin',
      status: 'exact',
      detectedCodeBuddyTools: ['discord_admin'],
    }));
  });
});

async function handleDiscordRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as unknown : undefined;
  const url = req.url ?? '/';
  requests.push({
    method: req.method ?? 'GET',
    path: url,
    authorization: req.headers.authorization,
    ...(parsedBody !== undefined ? { body: parsedBody } : {}),
  });

  if (req.method === 'GET' && url === '/channels/channel-123/messages?limit=2&before=999') {
    writeJson(res, [
      {
        id: 'msg-1',
        content: 'real Discord payload',
        author: {
          id: 'user-1',
          username: 'patrice',
          global_name: 'Patrice',
          bot: false,
        },
        timestamp: '2026-05-30T19:45:00.000Z',
        attachments: [],
        reactions: [],
        pinned: false,
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url === '/guilds/guild-1/members/search?query=pat&limit=5') {
    writeJson(res, [
      {
        user: {
          id: 'user-1',
          username: 'patrice',
          global_name: 'Patrice',
          bot: false,
        },
        nick: 'Patrice',
        roles: ['role-1'],
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url === '/users/@me/guilds') {
    writeJson(res, [
      {
        id: 'guild-1',
        name: 'Code Buddy Guild',
        icon: null,
        owner: false,
        permissions: '8',
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url === '/guilds/guild-1/channels') {
    writeJson(res, [
      {
        id: 'category-1',
        name: 'Engineering',
        type: 4,
        position: 1,
      },
      {
        id: 'channel-123',
        name: 'general',
        type: 0,
        position: 2,
        parent_id: 'category-1',
        topic: 'Work in progress',
        nsfw: false,
      },
    ]);
    return;
  }

  if (req.method === 'PUT' && url === '/guilds/guild-1/members/user-1/roles/role-1') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST' && url === '/channels/channel-123/threads') {
    expect(parsedBody).toEqual({
      name: 'Hermes parity thread',
      auto_archive_duration: 60,
      type: 11,
    });
    writeJson(res, {
      id: 'thread-1',
      name: 'Hermes parity thread',
    });
    return;
  }

  res.statusCode = 404;
  writeJson(res, { message: `Unhandled ${req.method} ${url}` });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, data: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
