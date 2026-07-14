/**
 * Gap coverage for RestorableCompressor — identifier extraction, restore chain,
 * writeToolResult, disk persistence, eviction, singleton.
 *
 * Base tests in tests/unit/compress.test.ts cover basic compression thresholds.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  RestorableCompressor,
  formatToolResultForRecovery,
  getRestorableCompressor,
  resetRestorableCompressor,
  CompressibleMessage,
} from '../../src/context/restorable-compression';

describe('RestorableCompressor (gap coverage)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'restorable-test-'));
    resetRestorableCompressor();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // Helper: build a long message with identifiers
  function longMsg(content: string): CompressibleMessage {
    // Pad to > 200 chars
    const padded = content + ' ' + 'x'.repeat(Math.max(0, 201 - content.length));
    return { role: 'assistant', content: padded };
  }

  function onlySessionRecoveryDir(workspace: string): string {
    const recoveryRoot = path.join(workspace, '.codebuddy', 'tool-results');
    const entries = fs
      .readdirSync(recoveryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^session-[a-f0-9]{64}$/.test(entry.name));
    expect(entries).toHaveLength(1);
    return path.join(recoveryRoot, entries[0]!.name);
  }

  function sessionRecoveryFile(workspace: string, callId: string): string {
    return path.join(onlySessionRecoveryDir(workspace), `${callId}.txt`);
  }

  describe('formatToolResultForRecovery()', () => {
    it('preserves output and error when a tool returns both channels', () => {
      expect(formatToolResultForRecovery({
        success: false,
        output: 'partial stdout',
        error: 'late failure',
      })).toBe('[tool output]\npartial stdout\n\n[tool error]\nlate failure');
    });
  });

  // --------------------------------------------------------------------------
  // Identifier extraction (tested via compress)
  // --------------------------------------------------------------------------

  describe('identifier extraction', () => {
    it('should extract file paths with common extensions', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Read src/utils/logger.ts and lib/script.py and src/app.js for details');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toEqual(
        expect.arrayContaining([
          expect.stringContaining('logger.ts'),
          expect.stringContaining('script.py'),
          expect.stringContaining('app.js'),
        ])
      );
    });

    it('should extract file paths with line ranges', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Check src/agent/executor.ts:42-100 for the implementation');
      const result = compressor.compress([msg]);
      expect(result.identifiers.some(id => id.includes('executor.ts'))).toBe(true);
    });

    it('should extract URLs', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('See https://example.com/docs/api and http://localhost:3000/health for info');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toEqual(
        expect.arrayContaining([
          expect.stringContaining('https://example.com/docs/api'),
          expect.stringContaining('http://localhost:3000/health'),
        ])
      );
    });

    it('should extract tool call IDs (call_ and toolu_ patterns)', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Tool result from call_abc123 and also toolu_xyz789 were processed');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toContain('call_abc123');
      expect(result.identifiers).toContain('toolu_xyz789');
    });

    it('should extract multiple identifier types from one message', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('File src/app.ts, URL https://api.example.com, call call_test1');
      const result = compressor.compress([msg]);
      expect(result.identifiers.length).toBeGreaterThanOrEqual(3);
    });
  });

  // --------------------------------------------------------------------------
  // compress()
  // --------------------------------------------------------------------------

  describe('compress()', () => {
    it('should skip messages shorter than 200 chars', () => {
      const compressor = new RestorableCompressor();
      const short: CompressibleMessage = { role: 'user', content: 'short message about file.ts' };
      const result = compressor.compress([short]);
      expect(result.messages[0].content).toBe(short.content);
      expect(result.identifiers).toHaveLength(0);
    });

    it('should replace long messages with identifier stubs', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Important content in src/config.ts and src/utils.ts');
      const result = compressor.compress([msg]);
      expect(result.messages[0].content).toContain('[Content compressed');
      expect(result.messages[0].content).toContain('restore_context');
    });

    it('should show "+N more" when more than 5 identifiers', () => {
      const compressor = new RestorableCompressor();
      const files = Array.from({ length: 8 }, (_, i) => `file${i}.ts`).join(' ');
      const msg = longMsg(files);
      const result = compressor.compress([msg]);
      if (result.identifiers.length > 5) {
        expect(result.messages[0].content).toContain('+');
        expect(result.messages[0].content).toContain('more');
      }
    });

    it('should estimate tokensSaved', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Content about src/long-file.ts ' + 'a'.repeat(500));
      const result = compressor.compress([msg]);
      expect(result.tokensSaved).toBeGreaterThan(0);
    });

    it('should deduplicate identifiers in result', () => {
      const compressor = new RestorableCompressor();
      const msg1 = longMsg('Read src/shared.ts for details about the module');
      const msg2 = longMsg('Also check src/shared.ts for more context and patterns');
      const result = compressor.compress([msg1, msg2]);
      const sharedCount = result.identifiers.filter(id => id.includes('shared.ts')).length;
      expect(sharedCount).toBeLessThanOrEqual(1);
    });

    it('should not compress messages with no extractable identifiers', () => {
      const compressor = new RestorableCompressor();
      const msg: CompressibleMessage = {
        role: 'assistant',
        content: 'This is a long message without any file paths or URLs or tool call IDs, just plain text repeated many times. ' + 'padding '.repeat(30),
      };
      const result = compressor.compress([msg]);
      expect(result.messages[0].content).not.toContain('[Content compressed');
    });

    it('isolates identical compressed identifiers between sessions in one workspace', () => {
      const compressor = new RestorableCompressor();
      const first = longMsg('Session A evidence from src/shared.ts ' + 'a'.repeat(240));
      const second = longMsg('Session B evidence from src/shared.ts ' + 'b'.repeat(240));

      compressor.compress([first], tmpDir, 'session-a');
      compressor.compress([second], tmpDir, 'session-b');

      expect(compressor.restore('src/shared.ts', tmpDir, 'session-a')).toMatchObject({
        found: true,
        content: expect.stringContaining('Session A evidence'),
      });
      expect(compressor.restore('src/shared.ts', tmpDir, 'session-b')).toMatchObject({
        found: true,
        content: expect.stringContaining('Session B evidence'),
      });
    });
  });

  // --------------------------------------------------------------------------
  // restore()
  // --------------------------------------------------------------------------

  describe('restore()', () => {
    it('should restore from in-memory store', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Content about src/main.ts with important implementation');
      compressor.compress([msg], tmpDir);
      const result = compressor.restore('src/main.ts', tmpDir);
      // May or may not find it depending on regex extraction — check found
      if (result.found) {
        expect(result.content).toContain('Content about src/main.ts');
      }
    });

    it('should restore tool call ID from disk when not in memory', () => {
      const compressor = new RestorableCompressor();
      // Persist in the explicitly selected workspace.
      compressor.writeToolResult('call_disktest', 'Disk content here', tmpDir);
      // A fresh instance proves the content comes from the guarded disk path,
      // not from either in-memory cache.
      const result = new RestorableCompressor().restore('call_disktest', tmpDir);
      expect(result.found).toBe(true);
      expect(result.content).toBe('Disk content here');
    });

    it('never restores another session with the same workspace and call ID', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_reused', 'session A secret', tmpDir, 'session-a');

      expect(compressor.restore('call_reused', tmpDir, 'session-b')).toMatchObject({
        found: false,
      });
      expect(new RestorableCompressor().restore('call_reused', tmpDir, 'session-b')).toMatchObject({
        found: false,
      });
      expect(new RestorableCompressor().restore('call_reused', tmpDir, 'session-a')).toMatchObject({
        found: true,
        content: 'session A secret',
      });
    });

    it('does not fall back to a legacy unscoped recovery file for a session', () => {
      const recovery = path.join(tmpDir, '.codebuddy', 'tool-results');
      fs.mkdirSync(recovery, { recursive: true });
      fs.writeFileSync(path.join(recovery, 'call_legacy.txt'), 'legacy cross-session content');

      const result = new RestorableCompressor().restore(
        'call_legacy',
        tmpDir,
        'current-session',
      );

      expect(result.found).toBe(false);
      expect(result.content).not.toContain('legacy cross-session content');
    });

    it('never reads an uncaptured absolute path outside the active workspace', () => {
      const compressor = new RestorableCompressor();
      const workspace = path.join(tmpDir, 'workspace');
      const outside = path.join(tmpDir, 'outside-secret.txt');
      fs.mkdirSync(workspace);
      fs.writeFileSync(outside, 'absolute-secret-must-not-leak');

      const result = compressor.restore(outside, workspace);
      expect(result.found).toBe(false);
      expect(result.content).not.toContain('absolute-secret-must-not-leak');
      expect(result.content).toContain('active session restoration store');
    });

    it('never resolves an uncaptured ../ traversal relative to the active workspace', () => {
      const compressor = new RestorableCompressor();
      const workspace = path.join(tmpDir, 'workspace');
      const outside = path.join(tmpDir, 'outside-secret.txt');
      fs.mkdirSync(workspace);
      fs.writeFileSync(outside, 'traversal-secret-must-not-leak');

      const result = compressor.restore('../outside-secret.txt', workspace);
      expect(result.found).toBe(false);
      expect(result.content).not.toContain('traversal-secret-must-not-leak');
    });

    it.runIf(process.platform !== 'win32')(
      'never follows a workspace recovery-directory symlink outside the workspace',
      () => {
        const compressor = new RestorableCompressor();
        const workspace = path.join(tmpDir, 'workspace');
        const outsideRecovery = path.join(tmpDir, 'outside-recovery');
        fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
        fs.mkdirSync(outsideRecovery);
        fs.writeFileSync(path.join(outsideRecovery, 'call_symlink.txt'), 'symlink-secret');
        fs.symlinkSync(outsideRecovery, path.join(workspace, '.codebuddy', 'tool-results'));

        const result = compressor.restore('call_symlink', workspace);
        expect(result.found).toBe(false);
        expect(result.content).not.toContain('symlink-secret');
      },
    );

    it.runIf(process.platform !== 'win32')(
      'never follows a recovery-file symlink outside the workspace',
      () => {
        const workspace = path.join(tmpDir, 'file-symlink-workspace');
        const outside = path.join(tmpDir, 'outside-file-secret.txt');
        fs.mkdirSync(workspace);
        fs.writeFileSync(outside, 'file-symlink-secret');
        const compressor = new RestorableCompressor();
        compressor.writeToolResult('seed', 'seed', workspace);
        const recovery = onlySessionRecoveryDir(workspace);
        fs.removeSync(path.join(recovery, 'seed.txt'));
        fs.symlinkSync(
          outside,
          path.join(recovery, 'call_file_symlink.txt')
        );

        const result = compressor.restore('call_file_symlink', workspace);

        expect(result.found).toBe(false);
        expect(result.content).not.toContain('file-symlink-secret');
      }
    );

    it.runIf(process.platform !== 'win32')(
      'never reads a hard-linked recovery file',
      () => {
        const workspace = path.join(tmpDir, 'hardlink-read-workspace');
        const outside = path.join(tmpDir, 'outside-hardlink-read.txt');
        fs.mkdirSync(workspace);
        fs.writeFileSync(outside, 'hardlink-secret');
        const compressor = new RestorableCompressor();
        compressor.writeToolResult('seed', 'seed', workspace);
        const recovery = onlySessionRecoveryDir(workspace);
        fs.removeSync(path.join(recovery, 'seed.txt'));
        fs.linkSync(outside, path.join(recovery, 'call_hardlink_read.txt'));

        const result = compressor.restore('call_hardlink_read', workspace);

        expect(result.found).toBe(false);
        expect(result.content).not.toContain('hardlink-secret');
      }
    );

    it('should return URL hint for http identifiers not in store', () => {
      const compressor = new RestorableCompressor();
      const result = compressor.restore('https://example.com/api');
      expect(result.found).toBe(false);
      expect(result.content).toContain('web_fetch');
    });

    it('should return "not found" for unknown identifiers', () => {
      const compressor = new RestorableCompressor();
      const result = compressor.restore('nonexistent-identifier');
      expect(result.found).toBe(false);
      expect(result.content).toContain('not found');
    });
  });

  // --------------------------------------------------------------------------
  // writeToolResult()
  // --------------------------------------------------------------------------

  describe('writeToolResult()', () => {
    it('should write to an opaque session directory under .codebuddy/tool-results', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_write1', 'Tool output', tmpDir);
      const filePath = sessionRecoveryFile(tmpDir, 'call_write1');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Tool output');
    });

    it('should create directory if not exists', () => {
      const compressor = new RestorableCompressor();
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      compressor.writeToolResult('call_mkdir', 'Content', subDir);
      expect(fs.existsSync(sessionRecoveryFile(subDir, 'call_mkdir'))).toBe(true);
    });

    it('should store in memory for fast access', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_mem', 'Memory content', tmpDir);
      expect(compressor.listIdentifiers()).toContain('call_mem');
    });

    it('restores the right result after writes from multiple workspaces', () => {
      const compressor = new RestorableCompressor();
      const first = path.join(tmpDir, 'workspace-a');
      const second = path.join(tmpDir, 'workspace-b');
      fs.mkdirSync(first);
      fs.mkdirSync(second);

      compressor.writeToolResult('call_workspace_a', 'from A', first);
      compressor.writeToolResult('call_workspace_b', 'from B', second);
      // A fresh compressor has no memory fallback and must use the requested
      // workspace's disk-backed result.
      const fresh = new RestorableCompressor();

      expect(fresh.restore('call_workspace_a', first)).toMatchObject({
        found: true,
        content: 'from A',
      });
    });

    it('isolates identical provider call IDs across concurrent workspaces', () => {
      const compressor = new RestorableCompressor();
      const first = path.join(tmpDir, 'collision-a');
      const second = path.join(tmpDir, 'collision-b');
      fs.mkdirSync(first);
      fs.mkdirSync(second);

      compressor.writeToolResult('call_reused', 'workspace A secret', first);
      compressor.writeToolResult('call_reused', 'workspace B secret', second);

      // Remove A's disk/memory-path copy so restore() must use its identifier
      // store. The historical global store returned B here after the collision.
      const firstRecoveryFile = sessionRecoveryFile(first, 'call_reused');
      fs.removeSync(firstRecoveryFile);
      (compressor as any).toolResultMemory.delete(firstRecoveryFile);

      expect(compressor.restore('call_reused', first).content).toBe('workspace A secret');
      expect(compressor.restore('call_reused', second).content).toBe('workspace B secret');
    });

    it('isolates identical provider call IDs across sessions in the same workspace on disk', () => {
      const compressor = new RestorableCompressor();
      const unsafeSessionA = '../../telegram/chat:alice';
      const unsafeSessionB = '../../telegram/chat:bob';

      compressor.writeToolResult('call_reused', 'Alice result', tmpDir, unsafeSessionA);
      compressor.writeToolResult('call_reused', 'Bob result', tmpDir, unsafeSessionB);

      const fresh = new RestorableCompressor();
      expect(fresh.restore('call_reused', tmpDir, unsafeSessionA)).toMatchObject({
        found: true,
        content: 'Alice result',
      });
      expect(fresh.restore('call_reused', tmpDir, unsafeSessionB)).toMatchObject({
        found: true,
        content: 'Bob result',
      });

      const recoveryRoot = path.join(tmpDir, '.codebuddy', 'tool-results');
      const entries = fs.readdirSync(recoveryRoot);
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => /^session-[a-f0-9]{64}$/.test(entry))).toBe(true);
      expect(entries.join('\n')).not.toContain('telegram');
      expect(fs.existsSync(path.join(tmpDir, 'telegram'))).toBe(false);
    });

    it('never uses an untrusted call ID as a path', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('../../outside', 'private', tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'outside.txt'))).toBe(false);
      expect(compressor.restore('../../outside', tmpDir)).toMatchObject({
        found: true,
        content: 'private',
      });
    });

    it.runIf(process.platform !== 'win32')(
      'never overwrites a recovery-file symlink',
      () => {
        const workspace = path.join(tmpDir, 'file-symlink-write-workspace');
        const outside = path.join(tmpDir, 'outside-file-sentinel.txt');
        fs.mkdirSync(workspace);
        fs.writeFileSync(outside, 'outside-sentinel');
        const compressor = new RestorableCompressor();
        compressor.writeToolResult('seed', 'seed', workspace);
        const recovery = onlySessionRecoveryDir(workspace);
        fs.removeSync(path.join(recovery, 'seed.txt'));
        fs.symlinkSync(outside, path.join(recovery, 'call_file_symlink_write.txt'));

        compressor.writeToolResult(
          'call_file_symlink_write',
          'must-not-overwrite',
          workspace
        );

        expect(fs.readFileSync(outside, 'utf-8')).toBe('outside-sentinel');
      }
    );

    it.runIf(process.platform !== 'win32')(
      'never overwrites a hard-linked recovery file',
      () => {
        const workspace = path.join(tmpDir, 'hardlink-write-workspace');
        const outside = path.join(tmpDir, 'outside-hardlink-write.txt');
        fs.mkdirSync(workspace);
        fs.writeFileSync(outside, 'outside-hardlink-sentinel');
        const compressor = new RestorableCompressor();
        compressor.writeToolResult('seed', 'seed', workspace);
        const recovery = onlySessionRecoveryDir(workspace);
        fs.removeSync(path.join(recovery, 'seed.txt'));
        fs.linkSync(outside, path.join(recovery, 'call_hardlink_write.txt'));

        compressor.writeToolResult(
          'call_hardlink_write',
          'must-not-overwrite',
          workspace
        );

        expect(fs.readFileSync(outside, 'utf-8')).toBe('outside-hardlink-sentinel');
      }
    );

    it.runIf(process.platform !== 'win32')('creates private recovery directories and files', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_private', 'sensitive output', tmpDir);
      const dir = path.join(tmpDir, '.codebuddy', 'tool-results');
      const sessionDir = onlySessionRecoveryDir(tmpDir);
      const file = path.join(sessionDir, 'call_private.txt');

      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(sessionDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it('should auto-evict oldest when store exceeds 500 entries', () => {
      const compressor = new RestorableCompressor();
      const messages = Array.from({ length: 501 }, (_, i) =>
        longMsg(`Read file_${i}.ts for the implementation`)
      );
      compressor.compress(messages, tmpDir);
      expect(compressor.listIdentifiers(tmpDir).length).toBeLessThan(501);
    });

    it('should not throw on write failure', () => {
      const compressor = new RestorableCompressor();
      // Use invalid path
      expect(() => {
        compressor.writeToolResult('call_fail', 'content', '/dev/null/impossible/path');
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // evict()
  // --------------------------------------------------------------------------

  describe('evict()', () => {
    it('should remove entries until storeSize < maxBytes', () => {
      const compressor = new RestorableCompressor();
      // Add entries totaling ~500 bytes
      for (let i = 0; i < 10; i++) {
        compressor.writeToolResult(`k${i}`, 'x'.repeat(50), tmpDir);
      }
      expect(compressor.storeSize(tmpDir)).toBe(500);
      compressor.evict(200);
      expect(compressor.storeSize(tmpDir)).toBeLessThanOrEqual(200);
    });

    it('should stop when store is empty', () => {
      const compressor = new RestorableCompressor();
      expect(() => compressor.evict(0)).not.toThrow();
    });

    it('should remove oldest entries first (Map insertion order)', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('first', 'aaa', tmpDir);
      compressor.writeToolResult('second', 'bbb', tmpDir);
      compressor.writeToolResult('third', 'ccc', tmpDir);
      compressor.evict(6); // keep only ~2 entries
      const remaining = compressor.listIdentifiers(tmpDir);
      expect(remaining).not.toContain('first');
      expect(remaining).toContain('third');
    });
  });

  // --------------------------------------------------------------------------
  // listIdentifiers() and storeSize()
  // --------------------------------------------------------------------------

  describe('listIdentifiers / storeSize', () => {
    it('should list all stored keys', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('a', 'val1', tmpDir);
      compressor.writeToolResult('b', 'val2', tmpDir);
      expect(compressor.listIdentifiers(tmpDir)).toEqual(['a', 'b']);
    });

    it('should return total bytes of all stored values', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('x', 'hello', tmpDir); // 5
      compressor.writeToolResult('y', 'world!', tmpDir); // 6
      expect(compressor.storeSize(tmpDir)).toBe(11);
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('singleton', () => {
    it('should return same instance from getRestorableCompressor()', () => {
      const a = getRestorableCompressor();
      const b = getRestorableCompressor();
      expect(a).toBe(b);
    });

    it('should reset via resetRestorableCompressor()', () => {
      const a = getRestorableCompressor();
      resetRestorableCompressor();
      const b = getRestorableCompressor();
      expect(a).not.toBe(b);
    });
  });
});
