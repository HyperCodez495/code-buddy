/**
 * Tests for `downloadModel` — the streaming HTTP downloader added in
 * Phase 3 of the face-memory branch.
 *
 * We spin up a real `http.createServer` on localhost (the downloader
 * accepts http:// for testability) and exercise:
 *   - happy path with content-length
 *   - happy path without content-length
 *   - 302 redirect chain
 *   - HTTP error status
 *   - bad magic byte (early reject)
 *   - oversize body (mid-stream reject)
 *   - undersize body (post-stream reject)
 *   - bad URL / bad protocol
 *
 * The test imports presence-bridge with mocked `electron`/`face-recognizer`
 * so the IPC side-effects don't fire — only `downloadModel` is exercised.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-presence-dl-'));
}

function fakeOnnx(sizeBytes: number, firstByte = 0x08): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0);
  buf[0] = firstByte;
  return buf;
}

interface ServerCtl {
  url: string;
  close: () => Promise<void>;
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<ServerCtl> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('downloadModel', () => {
  let tmpDir: string;
  let userDataDir: string;
  let modelDir: string;
  let modelPath: string;
  let downloadModel: typeof import('../src/main/presence/presence-bridge').downloadModel;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = makeTempDir();
    userDataDir = path.join(tmpDir, 'userData');
    modelDir = path.join(userDataDir, 'models');
    modelPath = path.join(modelDir, 'buffalo_s.onnx');

    vi.doMock('electron', () => ({
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
      dialog: { showOpenDialog: vi.fn() },
    }));
    vi.doMock('../src/main/utils/logger', () => ({
      log: vi.fn(),
      logError: vi.fn(),
    }));
    vi.doMock('../src/main/presence/face-recognizer', () => ({
      FaceRecognizer: { defaultModelPath: () => modelPath },
      getFaceRecognizer: () => ({ isReady: () => true, initialize: vi.fn() }),
    }));
    vi.doMock('../src/main/presence/presence-store', () => ({
      getPresenceStore: () => ({
        addPerson: vi.fn(),
        addFaceSample: vi.fn(),
        match: vi.fn(),
        listPersons: vi.fn().mockResolvedValue([]),
        removePerson: vi.fn(),
      }),
    }));

    const mod = await import('../src/main/presence/presence-bridge');
    downloadModel = mod.downloadModel;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('downloads a valid model with content-length and reports progress', async () => {
    const body = fakeOnnx(13 * 1024 * 1024);
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      res.end(body);
    });

    const progress: Array<{ bytes: number; total: number | null }> = [];
    try {
      const result = await downloadModel(`${server.url}/buffalo_s.onnx`, (b, t) => {
        progress.push({ bytes: b, total: t });
      });
      expect(result.ok).toBe(true);
      expect(result.installedPath).toBe(modelPath);
      expect(fs.existsSync(modelPath)).toBe(true);
      const onDisk = await fsp.readFile(modelPath);
      expect(onDisk.length).toBe(body.length);
      expect(onDisk[0]).toBe(0x08);
      // We always emit at least the final 100% event.
      expect(progress.length).toBeGreaterThan(0);
      const last = progress[progress.length - 1];
      expect(last.bytes).toBe(body.length);
      expect(last.total).toBe(body.length);
    } finally {
      await server.close();
    }
  });

  it('downloads when content-length is missing (chunked transfer)', async () => {
    const body = fakeOnnx(6 * 1024 * 1024);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      // Force chunked by not setting content-length and writing in pieces.
      res.write(body.subarray(0, body.length / 2));
      res.end(body.subarray(body.length / 2));
    });

    try {
      const result = await downloadModel(`${server.url}/x.onnx`, () => {});
      expect(result.ok).toBe(true);
      expect(fs.existsSync(modelPath)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('follows a 302 redirect to the same origin', async () => {
    const body = fakeOnnx(6 * 1024 * 1024);
    const server = await startServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/real' });
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      res.end(body);
    });

    try {
      const result = await downloadModel(`${server.url}/start`, () => {});
      expect(result.ok).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('rejects when the server returns a non-200 status', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    try {
      const result = await downloadModel(`${server.url}/missing.onnx`, () => {});
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/HTTP 404/);
      expect(fs.existsSync(modelPath)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('rejects a downloaded body whose first byte is not 0x08 (zip lookalike)', async () => {
    const body = fakeOnnx(6 * 1024 * 1024, 0x50); // 'P' — start of PK zip
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      res.end(body);
    });
    try {
      const result = await downloadModel(`${server.url}/zip-as-onnx`, () => {});
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Mm]agic byte/);
      // The .tmp file must be cleaned up.
      expect(fs.existsSync(`${modelPath}.tmp`)).toBe(false);
      expect(fs.existsSync(modelPath)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('rejects a body whose advertised content-length exceeds the cap', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(60 * 1024 * 1024),
      });
      res.end(); // body irrelevant — header check rejects pre-stream
    });
    try {
      const result = await downloadModel(`${server.url}/huge`, () => {});
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Tt]aille/);
    } finally {
      await server.close();
    }
  });

  it('rejects a body that is too small to be Buffalo_S', async () => {
    const body = fakeOnnx(1024); // 1 KB
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(body); // no content-length header → goes through the stream path
    });
    try {
      const result = await downloadModel(`${server.url}/tiny`, () => {});
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Tt]rop petite/i);
      expect(fs.existsSync(modelPath)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('rejects a malformed URL', async () => {
    const result = await downloadModel('not-a-url', () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/URL/);
  });

  it('rejects a non-http(s) protocol', async () => {
    const result = await downloadModel('file:///etc/passwd', () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/[Pp]rotocole/);
  });
});
