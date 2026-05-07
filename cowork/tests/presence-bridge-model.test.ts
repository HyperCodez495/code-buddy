/**
 * Tests for the model-install IPC surface added in Phase 1 of the
 * face-memory branch:
 *   - presence:has-model
 *   - presence:install-model-from-path
 *   - presence:select-model-file (skipped — pure dialog wrapper)
 *
 * We mock `electron` (`ipcMain`, `dialog`), face-recognizer (only its
 * static `defaultModelPath()`), and presence-store (its dependencies
 * never run because we don't invoke matching handlers here).
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, payload: unknown) => Promise<unknown>;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-presence-model-'));
}

/**
 * Minimal valid ONNX header — first byte is the protobuf field tag for
 * field 1, wire type 0 (varint). Anything else fails the magic-byte check.
 */
function writeFakeOnnx(filePath: string, sizeBytes: number): void {
  const buf = Buffer.alloc(sizeBytes, 0); // zero-fill
  buf[0] = 0x08;
  fs.writeFileSync(filePath, buf);
}

describe('PresenceBridge model install IPC', () => {
  let tmpDir: string;
  let userDataDir: string;
  let modelDir: string;
  let modelPath: string;
  let handlers: Map<string, IpcHandler>;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = makeTempDir();
    userDataDir = path.join(tmpDir, 'userData');
    modelDir = path.join(userDataDir, 'models');
    modelPath = path.join(modelDir, 'buffalo_s.onnx');
    handlers = new Map();

    vi.doMock('electron', () => ({
      ipcMain: {
        handle: (channel: string, fn: IpcHandler) => {
          handlers.set(channel, fn);
        },
        removeHandler: (channel: string) => {
          handlers.delete(channel);
        },
      },
      dialog: {
        showOpenDialog: vi.fn(),
      },
    }));

    vi.doMock('../src/main/utils/logger', () => ({
      log: vi.fn(),
      logError: vi.fn(),
    }));

    vi.doMock('../src/main/presence/face-recognizer', () => ({
      FaceRecognizer: {
        defaultModelPath: () => modelPath,
      },
      getFaceRecognizer: () => ({
        isReady: () => true,
        initialize: vi.fn(),
        encode: vi.fn(),
      }),
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

    // Importing the module registers the IPC handlers via the constructor.
    const mod = await import('../src/main/presence/presence-bridge');
    mod.getPresenceBridge();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('presence:has-model', () => {
    it('returns installed=false when the model file is absent', async () => {
      const handler = handlers.get('presence:has-model');
      expect(handler).toBeDefined();
      const result = (await handler!({}, undefined)) as {
        installed: boolean;
        path: string;
      };
      expect(result.installed).toBe(false);
      expect(result.path).toBe(modelPath);
    });

    it('returns installed=true when the model file is present', async () => {
      await fsp.mkdir(modelDir, { recursive: true });
      writeFakeOnnx(modelPath, 13 * 1024 * 1024);
      const handler = handlers.get('presence:has-model');
      const result = (await handler!({}, undefined)) as {
        installed: boolean;
        path: string;
      };
      expect(result.installed).toBe(true);
      expect(result.path).toBe(modelPath);
    });
  });

  describe('presence:install-model-from-path', () => {
    it('copies a valid ONNX file to the destination path', async () => {
      const sourcePath = path.join(tmpDir, 'buffalo_s.onnx');
      writeFakeOnnx(sourcePath, 13 * 1024 * 1024);

      const handler = handlers.get('presence:install-model-from-path');
      expect(handler).toBeDefined();
      const result = (await handler!({}, { sourcePath })) as {
        ok: boolean;
        error?: string;
        installedPath?: string;
      };

      expect(result.ok).toBe(true);
      expect(result.installedPath).toBe(modelPath);
      expect(fs.existsSync(modelPath)).toBe(true);
      const copied = fs.readFileSync(modelPath);
      expect(copied[0]).toBe(0x08);
    });

    it('rejects a file with an invalid magic byte (e.g. a zip)', async () => {
      const sourcePath = path.join(tmpDir, 'fake.zip');
      const buf = Buffer.alloc(13 * 1024 * 1024, 0);
      buf[0] = 0x50; // 'P' — start of PK zip header
      fs.writeFileSync(sourcePath, buf);

      const handler = handlers.get('presence:install-model-from-path');
      const result = (await handler!({}, { sourcePath })) as {
        ok: boolean;
        error?: string;
      };

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Mm]agic byte/);
      expect(fs.existsSync(modelPath)).toBe(false);
    });

    it('rejects a file too small to be Buffalo_S', async () => {
      const sourcePath = path.join(tmpDir, 'tiny.onnx');
      writeFakeOnnx(sourcePath, 1024); // 1 KB — way under the 5 MB floor

      const handler = handlers.get('presence:install-model-from-path');
      const result = (await handler!({}, { sourcePath })) as {
        ok: boolean;
        error?: string;
      };

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Tt]aille/);
      expect(fs.existsSync(modelPath)).toBe(false);
    });

    it('rejects a file too large to be Buffalo_S', async () => {
      const sourcePath = path.join(tmpDir, 'huge.onnx');
      // 60 MB — past the 50 MB ceiling. Use ftruncate to avoid a 60 MB
      // RAM allocation in CI: open + write a single byte at offset 60 MB - 1.
      const fh = fs.openSync(sourcePath, 'w');
      fs.writeSync(fh, Buffer.from([0x08]), 0, 1, 0);
      fs.ftruncateSync(fh, 60 * 1024 * 1024);
      fs.closeSync(fh);

      const handler = handlers.get('presence:install-model-from-path');
      const result = (await handler!({}, { sourcePath })) as {
        ok: boolean;
        error?: string;
      };

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/[Tt]aille/);
      expect(fs.existsSync(modelPath)).toBe(false);
    });

    it('returns ok=false with an error when the source path does not exist', async () => {
      const handler = handlers.get('presence:install-model-from-path');
      const result = (await handler!({}, { sourcePath: path.join(tmpDir, 'nope.onnx') })) as {
        ok: boolean;
        error?: string;
      };

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
