import { execFile } from 'child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RUNNER = resolve('scripts/gpu-runners/panoworld-runner.py');
const created: string[] = [];

async function fixture(width = 2, height = 1): Promise<{
  root: string;
  request: string;
  result: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'codebuddy-panoworld-runner-'));
  created.push(root);
  const modelRoot = join(root, 'PanoWorld');
  const input = join(root, 'input.ppm');
  const output = join(root, 'output');
  const checkpoint = join(modelRoot, 'checkpoints', 'ckpt_panoworld_lrm_2048_1024.ckpt');
  const request = join(root, 'request.json');
  const result = join(root, 'result.json');
  await mkdir(join(modelRoot, 'configs'), { recursive: true });
  await mkdir(join(modelRoot, 'checkpoints'), { recursive: true });
  await mkdir(output);
  await writeFile(input, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.alloc(width * height * 3, 128)]));
  await writeFile(checkpoint, 'verified-test-checkpoint');
  await writeFile(join(modelRoot, 'configs', 'inference_2048_1024.yaml'), 'test: true\n');
  await writeFile(join(modelRoot, 'configs', 'inference_1024_512.yaml'), 'test: true\n');
  await writeFile(
    join(modelRoot, 'inference.py'),
    [
      'import pathlib, sys',
      'arg = next(value for value in sys.argv if value.startswith("inference.out_dir="))',
      'out = pathlib.Path(arg.split("=", 1)[1]) / "scene" / "views" / "output_ply"',
      '(out / "point_cloud" / "iteration_0").mkdir(parents=True, exist_ok=True)',
      '(out / "point_cloud" / "iteration_0" / "point_cloud.ply").write_text("ply")',
      '(out / "cameras.json").write_text("[]")',
      '(out / "render.png").write_bytes(b"png")',
      '(out / "depth.png").write_bytes(b"depth")',
    ].join('\n')
  );
  await writeFile(
    request,
    JSON.stringify({
      id: 'gpu-test',
      kind: 'panoworld_reconstruct',
      payload: {
        sceneId: 'kitchen',
        profile: 'single-2048',
        panoramas: [{ imagePath: input, roomId: 'kitchen' }],
        outputDir: output,
      },
    })
  );
  return { root, request, result };
}

afterEach(async () => {
  const { rm } = await import('fs/promises');
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('PanoWorld GPU runner', () => {
  it('prepares RealSee3D input and writes a verified manifest', async () => {
    const item = await fixture();
    const modelRoot = join(item.root, 'PanoWorld');
    const { stdout } = await execFileAsync('python3', [RUNNER, item.request], {
      env: {
        ...process.env,
        CODEBUDDY_GPU_JOB_RESULT: item.result,
        CODEBUDDY_PANOWORLD_ROOT: modelRoot,
      },
    });

    const manifest = JSON.parse(await readFile(item.result, 'utf8')) as Record<string, unknown>;
    expect(stdout).toContain('CODEBUDDY_PROGRESS 1.00');
    expect(manifest).toMatchObject({
      sceneId: 'kitchen',
      profile: 'single-2048',
      viewCount: 1,
    });
    expect(String(manifest.plyPath)).toContain('point_cloud.ply');
    expect(manifest.checkpointSha256).toMatch(/^[a-f0-9]{64}$/u);
    const staging = join(item.root, 'panoworld-staging', 'data', 'codebuddy_scene');
    expect(JSON.parse(await readFile(join(staging, 'map.json'), 'utf8'))).toEqual({
      view_000: [],
    });
    expect(await readFile(join(staging, 'viewpoints', 'view_000', 'extrinsics.txt'), 'utf8')).toContain(
      '1 0 0 0'
    );
  });

  it('rejects multi-view input without measured camera poses', async () => {
    const item = await fixture();
    const raw = JSON.parse(await readFile(item.request, 'utf8')) as {
      payload: Record<string, unknown>;
    };
    raw.payload.profile = 'multi-1024';
    await writeFile(item.request, JSON.stringify(raw));

    await expect(
      execFileAsync('python3', [RUNNER, item.request], {
        env: {
          ...process.env,
          CODEBUDDY_GPU_JOB_RESULT: item.result,
          CODEBUDDY_PANOWORLD_ROOT: join(item.root, 'PanoWorld'),
          CODEBUDDY_PANOWORLD_1024_CHECKPOINT: join(
            item.root,
            'PanoWorld',
            'checkpoints',
            'ckpt_panoworld_lrm_2048_1024.ckpt'
          ),
        },
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('requires a cameraToWorld matrix') });
  });

  it('rejects panoramas that are not exactly 2:1', async () => {
    const item = await fixture(2, 2);
    await expect(
      execFileAsync('python3', [RUNNER, item.request], {
        env: {
          ...process.env,
          CODEBUDDY_GPU_JOB_RESULT: item.result,
          CODEBUDDY_PANOWORLD_ROOT: join(item.root, 'PanoWorld'),
        },
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('exact 2:1 ratio') });
  });
});
