import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

const coreLoaderMock = vi.hoisted(() => ({
  loadCoreModule: vi.fn(),
}));

const sagaRunnerMock = vi.hoisted(() => ({
  instances: [] as Array<{ start: ReturnType<typeof vi.fn> }>,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
  },
}));

vi.mock('../src/main/fleet/saga-runner', () => ({
  SagaRunner: class {
    start = vi.fn();

    constructor() {
      sagaRunnerMock.instances.push(this);
    }
  },
}));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: coreLoaderMock.loadCoreModule,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { registerFleetIpcHandlers } from '../src/main/ipc/fleet-ipc';
import type { FleetBridge } from '../src/main/fleet/fleet-bridge';

describe('registerFleetIpcHandlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
    coreLoaderMock.loadCoreModule.mockReset();
    sagaRunnerMock.instances = [];
  });

  it('wires manual Fleet capability refresh through IPC', async () => {
    const refreshCapabilities = vi.fn(async (peerId?: string) => ({
      success: true,
      peer: peerId ? { id: peerId } : undefined,
    }));
    const bridge = { refreshCapabilities } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    const result = await handler?.({}, 'ministar-linux');
    expect(refreshCapabilities).toHaveBeenCalledWith('ministar-linux');
    expect(result).toEqual({ success: true, peer: { id: 'ministar-linux' } });
  });

  it('returns a structured refresh error when FleetBridge is unavailable', async () => {
    registerFleetIpcHandlers(null);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    await expect(handler?.({})).resolves.toEqual({
      success: false,
      error: 'FleetBridge not initialized',
    });
  });

  it('refuses Fleet dispatch when no peer has known capabilities', async () => {
    const modules = installDispatchCoreModules();
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux' }]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    await expect(handler?.({}, { goal: 'Audit the CLI' })).resolves.toEqual({
      ok: false,
      error:
        'No peer with known capabilities — use the Command Center refresh button, then verify the peer key has both fleet:listen and peer:invoke scopes.',
    });
    expect(modules.createSaga).not.toHaveBeenCalled();
  });

  it('dispatches a Fleet saga using peer.describe capability slots', async () => {
    const modules = installDispatchCoreModules();
    const capability = {
      egress: 'cloud',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
          contextWindow: 200_000,
          strengths: ['code'],
        },
      ],
    };
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux', capability }]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    const result = await handler?.({}, {
      goal: 'Audit the CLI',
      parallelism: 2,
      privacyTag: 'public',
    });

    expect(modules.plan).toHaveBeenCalledWith(
      { kind: 'coding' },
      [{ peerId: 'ministar-linux', capability }],
      expect.objectContaining({ parallelism: 2, privacyTag: 'public' }),
    );
    expect(modules.createSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Audit the CLI',
        plan: modules.dispatchPlan,
      }),
    );
    expect(sagaRunnerMock.instances[0].start).toHaveBeenCalledWith('saga-1');
    expect(result).toMatchObject({ ok: true, sagaId: 'saga-1', privacyTag: 'public' });
  });
});

function installDispatchCoreModules() {
  const dispatchPlan = {
    steps: [
      {
        peerId: 'ministar-linux',
        model: 'gpt-5.1-codex',
        lane: 'primary',
      },
    ],
  };
  const plan = vi.fn(() => dispatchPlan);
  const createSaga = vi.fn(async () => ({ id: 'saga-1' }));

  coreLoaderMock.loadCoreModule.mockImplementation(async (moduleName: string) => {
    switch (moduleName) {
      case 'fleet/task-router.js':
        return { TaskRouter: class { plan = plan; } };
      case 'optimization/model-routing.js':
        return { classifyTaskComplexity: vi.fn(() => ({ kind: 'coding' })) };
      case 'fleet/saga-store.js':
        return { getSagaStore: () => ({ create: createSaga }) };
      case 'fleet/privacy-lint.js':
        return {
          scanForSecrets: vi.fn(() => ({
            hasSecrets: false,
            highConfidence: false,
            matches: [],
          })),
        };
      case 'fleet/cost-tracker.js':
        return { getCostTracker: () => ({ canSpend: vi.fn(async () => ({ ok: true })) }) };
      default:
        return null;
    }
  });

  return { createSaga, dispatchPlan, plan };
}
