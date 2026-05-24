import { EventEmitter } from 'events';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import {
  buildCameraSnapshotArgs,
  captureCameraSnapshot,
  checkCameraAvailability,
  getDefaultCameraOutputPath,
  type CameraRuntime,
} from '../src/companion/camera.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';

function createRuntime(options: {
  ffmpegAvailable?: boolean;
  spawnCode?: number;
  stderr?: string;
  writeOutput?: boolean;
} = {}): CameraRuntime {
  const {
    ffmpegAvailable = true,
    spawnCode = 0,
    stderr = '',
    writeOutput = true,
  } = options;

  return {
    execFile: vi.fn((_command, _args, _options, callback) => {
      if (!ffmpegAvailable) {
        callback(new Error('ffmpeg not found'), '', 'not found');
        return;
      }
      callback(null, 'ffmpeg version 6', '');
    }),
    spawn: vi.fn((_command, args) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);

      setImmediate(async () => {
        if (stderr) child.stderr.emit('data', stderr);
        if (writeOutput && spawnCode === 0) {
          await writeFile(args[args.length - 1], 'png-data');
        }
        child.emit('close', spawnCode);
      });

      return child;
    }),
  } as unknown as CameraRuntime;
}

describe('companion camera bridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-camera-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('builds platform-specific ffmpeg camera arguments', () => {
    expect(buildCameraSnapshotArgs('win32', 'video=USB Camera', 'out.png')).toEqual([
      '-y',
      '-f',
      'dshow',
      '-i',
      'video=USB Camera',
      '-frames:v',
      '1',
      'out.png',
    ]);
    expect(buildCameraSnapshotArgs('darwin', undefined, 'out.png')).toContain('avfoundation');
    expect(buildCameraSnapshotArgs('linux', undefined, 'out.png')).toContain('/dev/video0');
  });

  it('reports camera availability from ffmpeg presence', async () => {
    const ok = await checkCameraAvailability({
      runtime: createRuntime({ ffmpegAvailable: true }),
      platform: 'linux',
    });
    expect(ok.available).toBe(true);
    expect(ok.commandPreview).toContain('ffmpeg');

    const missing = await checkCameraAvailability({
      runtime: createRuntime({ ffmpegAvailable: false }),
      platform: 'linux',
    });
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain('ffmpeg is required');
  });

  it('captures a webcam snapshot into the workspace camera directory by default', async () => {
    const runtime = createRuntime();
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      runtime,
      platform: 'linux',
    });

    expect(result.success).toBe(true);
    expect(result.path).toContain(path.join('.codebuddy', 'camera'));
    expect(result.command).toContain('ffmpeg');
    expect(result.perceptId).toContain('percept-');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts[0]).toMatchObject({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: expect.stringContaining('Captured camera snapshot'),
    });
  });

  it('captures a webcam snapshot to an explicit output path', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'custom/scene.png',
      runtime: createRuntime(),
      platform: 'darwin',
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(tempDir, 'custom', 'scene.png'));
  });

  it('returns actionable troubleshooting when ffmpeg cannot open a Windows camera', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'scene.png',
      runtime: createRuntime({
        spawnCode: 1,
        stderr: 'Could not find video device',
        writeOutput: false,
      }),
      platform: 'win32',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ffmpeg -list_devices true -f dshow -i dummy');
  });

  it('creates deterministic default output paths for status previews', () => {
    const output = getDefaultCameraOutputPath('/repo', new Date('2026-05-24T12:34:56Z'));
    expect(output).toBe(path.join('/repo', '.codebuddy', 'camera', 'camera-20260524-123456.png'));
  });
});
