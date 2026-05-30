import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createSpotifyTools } from '../../src/tools/registry/spotify-tools.js';
import type { ITool } from '../../src/tools/registry/types.js';

interface CapturedRequest {
  method: string;
  pathname: string;
  query: Record<string, string>;
  authorization?: string;
  body?: unknown;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes Spotify real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleSpotifyRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('covers Spotify playback, devices, queue, and search through real HTTP routes', async () => {
    const search = await tool('spotify_search').execute({
      query: 'miles davis kind of blue',
      types: ['album'],
      limit: 1,
    });
    expect(search.success, search.error).toBe(true);
    expect(JSON.parse(search.output as string)).toMatchObject({
      kind: 'spotify_search_result',
      result: {
        albums: {
          items: [
            {
              uri: 'spotify:album:album123',
            },
          ],
        },
      },
    });

    const play = await tool('spotify_playback').execute({
      action: 'play',
      context_uri: 'https://open.spotify.com/album/album123',
      device_id: 'device-1',
    });
    expect(play.success, play.error).toBe(true);

    const currentlyPlaying = await tool('spotify_playback').execute({
      action: 'get_currently_playing',
    });
    expect(JSON.parse(currentlyPlaying.output as string)).toMatchObject({
      result: {
        is_playing: false,
        status_code: 204,
      },
    });

    const transfer = await tool('spotify_devices').execute({
      action: 'transfer',
      device_id: 'device-1',
      play: true,
    });
    expect(transfer.success, transfer.error).toBe(true);

    const queue = await tool('spotify_queue').execute({
      action: 'add',
      uri: 'spotify:track:track123',
      device_id: 'device-1',
    });
    expect(queue.success, queue.error).toBe(true);

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        pathname: '/search',
        query: {
          q: 'miles davis kind of blue',
          type: 'album',
          limit: '1',
          offset: '0',
        },
        authorization: 'Bearer spotify-test-token',
      }),
      expect.objectContaining({
        method: 'PUT',
        pathname: '/me/player/play',
        query: { device_id: 'device-1' },
        body: { context_uri: 'spotify:album:album123' },
      }),
      expect.objectContaining({
        method: 'GET',
        pathname: '/me/player/currently-playing',
      }),
      expect.objectContaining({
        method: 'PUT',
        pathname: '/me/player',
        body: {
          device_ids: ['device-1'],
          play: true,
        },
      }),
      expect.objectContaining({
        method: 'POST',
        pathname: '/me/player/queue',
        query: {
          uri: 'spotify:track:track123',
          device_id: 'device-1',
        },
      }),
    ]));
  });

  it('covers Spotify playlist, album, and library operations through real HTTP routes', async () => {
    const createPlaylist = await tool('spotify_playlists').execute({
      action: 'create',
      name: 'Focus 2026',
      description: 'Working set',
      public: false,
    });
    expect(createPlaylist.success, createPlaylist.error).toBe(true);

    const addItems = await tool('spotify_playlists').execute({
      action: 'add_items',
      playlist_id: 'spotify:playlist:playlist123',
      uris: ['https://open.spotify.com/track/track123', 'spotify:track:track123'],
    });
    expect(addItems.success, addItems.error).toBe(true);

    const albumTracks = await tool('spotify_albums').execute({
      action: 'tracks',
      album_id: 'https://open.spotify.com/album/album123',
      limit: 2,
    });
    expect(albumTracks.success, albumTracks.error).toBe(true);

    const listTracks = await tool('spotify_library').execute({
      kind: 'tracks',
      action: 'list',
      limit: 2,
    });
    expect(listTracks.success, listTracks.error).toBe(true);

    const saveAlbum = await tool('spotify_library').execute({
      kind: 'albums',
      action: 'save',
      uris: ['album123'],
    });
    expect(saveAlbum.success, saveAlbum.error).toBe(true);

    const removeTrack = await tool('spotify_library').execute({
      kind: 'tracks',
      action: 'remove',
      ids: ['track123'],
    });
    expect(removeTrack.success, removeTrack.error).toBe(true);

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'POST',
        pathname: '/me/playlists',
        body: {
          name: 'Focus 2026',
          public: false,
          collaborative: false,
          description: 'Working set',
        },
      }),
      expect.objectContaining({
        method: 'POST',
        pathname: '/playlists/playlist123/items',
        body: {
          uris: ['spotify:track:track123'],
        },
      }),
      expect.objectContaining({
        method: 'GET',
        pathname: '/albums/album123/tracks',
        query: {
          limit: '2',
          offset: '0',
        },
      }),
      expect.objectContaining({
        method: 'GET',
        pathname: '/me/tracks',
        query: {
          limit: '2',
          offset: '0',
        },
      }),
      expect.objectContaining({
        method: 'PUT',
        pathname: '/me/library',
        query: {
          uris: 'spotify:album:album123',
        },
      }),
      expect.objectContaining({
        method: 'DELETE',
        pathname: '/me/library',
        query: {
          uris: 'spotify:track:track123',
        },
      }),
    ]));
  });

  it('marks all official Hermes Spotify tools as exact local parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T22:00:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'spotify_playback', status: 'exact', detectedCodeBuddyTools: ['spotify_playback'] }),
      expect.objectContaining({ name: 'spotify_devices', status: 'exact', detectedCodeBuddyTools: ['spotify_devices'] }),
      expect.objectContaining({ name: 'spotify_queue', status: 'exact', detectedCodeBuddyTools: ['spotify_queue'] }),
      expect.objectContaining({ name: 'spotify_search', status: 'exact', detectedCodeBuddyTools: ['spotify_search'] }),
      expect.objectContaining({ name: 'spotify_playlists', status: 'exact', detectedCodeBuddyTools: ['spotify_playlists'] }),
      expect.objectContaining({ name: 'spotify_albums', status: 'exact', detectedCodeBuddyTools: ['spotify_albums'] }),
      expect.objectContaining({ name: 'spotify_library', status: 'exact', detectedCodeBuddyTools: ['spotify_library'] }),
    ]));
  });
});

function tool(name: string): ITool {
  const found = createSpotifyTools({ accessToken: 'spotify-test-token', apiBaseUrl: baseUrl })
    .find((item) => item.name === name);
  expect(found).toBeTruthy();
  return found!;
}

async function handleSpotifyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as unknown : undefined;
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  requests.push({
    method: req.method ?? 'GET',
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    authorization: req.headers.authorization,
    ...(parsedBody !== undefined ? { body: parsedBody } : {}),
  });

  if (url.pathname === '/me/player/currently-playing') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (['PUT', 'POST', 'DELETE'].includes(req.method ?? '') && [
    '/me/player/play',
    '/me/player',
    '/me/player/queue',
    '/me/library',
  ].includes(url.pathname)) {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/search') {
    writeJson(res, {
      albums: {
        items: [
          {
            id: 'album123',
            name: 'Kind of Blue',
            uri: 'spotify:album:album123',
          },
        ],
      },
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/me/playlists') {
    writeJson(res, { id: 'playlist123', name: 'Focus 2026', uri: 'spotify:playlist:playlist123' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/playlists/playlist123/items') {
    writeJson(res, { snapshot_id: 'snapshot-1' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/albums/album123/tracks') {
    writeJson(res, {
      items: [
        {
          id: 'track123',
          uri: 'spotify:track:track123',
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/me/tracks') {
    writeJson(res, {
      items: [
        {
          track: {
            id: 'track123',
            uri: 'spotify:track:track123',
          },
        },
      ],
    });
    return;
  }

  res.statusCode = 404;
  writeJson(res, { error: { message: `Unhandled ${req.method} ${url.pathname}` } });
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
