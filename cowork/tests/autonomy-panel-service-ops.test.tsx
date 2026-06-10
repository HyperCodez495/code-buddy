/**
 * @vitest-environment happy-dom
 *
 * AutonomyPanel service operations: log tailing (journalctl viewer) and
 * the custom install form (model / Ollama URL / interval / executor with
 * fail-closed workspace requirement for the agent executor).
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutonomyPanel } from '../src/renderer/components/AutonomyPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptySnapshot = {
  ok: true,
  dir: '/home/u/.codebuddy/fleet',
  tasks: [],
  worklog: [],
  presence: {},
};

function makeAutonomyApi(service: { installed: boolean; running: boolean }) {
  return {
    snapshot: vi.fn().mockResolvedValue(emptySnapshot),
    daemonStatus: vi.fn().mockResolvedValue({
      ok: true,
      serviceName: 'codebuddy-autonomy',
      service: { ...service, platform: 'linux' },
      queueDir: '/home/u/.codebuddy/fleet',
      manageCommand: 'systemctl --user status codebuddy-autonomy',
    }),
    serviceControl: vi.fn().mockResolvedValue({ ok: true, action: 'start', service: null }),
    serviceInstall: vi.fn().mockResolvedValue({ ok: true }),
    serviceUninstall: vi.fn().mockResolvedValue({ ok: true }),
    runTick: vi.fn().mockResolvedValue({ ok: true, ticks: 1 }),
    modelTier: vi.fn().mockResolvedValue({ ok: true, ladder: [] }),
    serviceLogs: vi.fn().mockResolvedValue({
      ok: true,
      source: 'journalctl --user -u codebuddy-autonomy',
      lines: ['07:00:00 tick claimed task-1', '07:00:03 tick completed'],
    }),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPanel(api: ReturnType<typeof makeAutonomyApi>) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { autonomy: api };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AutonomyPanel isOpen onClose={() => {}} />);
  });
}

function query(testId: string): HTMLElement | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

async function click(testId: string) {
  const el = query(testId) as HTMLButtonElement | null;
  expect(el, `element ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.click();
  });
}

async function setValue(testId: string, value: string) {
  const el = query(testId) as HTMLInputElement | HTMLSelectElement | null;
  expect(el, `input ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.value = value;
    Simulate.change(el!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('AutonomyPanel service logs', () => {
  it('tails the unit logs from the Logs toggle', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    await renderPanel(api);

    await click('autonomy-daemon-logs-toggle');

    expect(api.serviceLogs).toHaveBeenCalledWith(120);
    const panel = query('autonomy-daemon-logs');
    expect(panel?.textContent).toContain('journalctl --user -u codebuddy-autonomy');
    expect(panel?.textContent).toContain('tick claimed task-1');
  });

  it('shows the honest non-Linux error instead of a fake tail', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    api.serviceLogs.mockResolvedValue({
      ok: false,
      error: 'Log tailing is wired for systemd (Linux) only — inspect with: launchctl list codebuddy-autonomy',
    });
    await renderPanel(api);

    await click('autonomy-daemon-logs-toggle');

    expect(query('autonomy-daemon-logs-error')?.textContent).toContain('launchctl');
  });

  it('hides the Logs toggle when the service is not installed', async () => {
    await renderPanel(makeAutonomyApi({ installed: false, running: false }));

    expect(query('autonomy-daemon-logs-toggle')).toBeNull();
  });
});

describe('AutonomyPanel custom install', () => {
  it('installs with a custom model and interval through the options form', async () => {
    const api = makeAutonomyApi({ installed: false, running: false });
    await renderPanel(api);

    await click('autonomy-daemon-install-options-toggle');
    await setValue('autonomy-install-model', 'qwen3.6:27b');
    await setValue('autonomy-install-interval', '30000');
    await click('autonomy-daemon-install-custom');

    expect(api.serviceInstall).toHaveBeenCalledWith({
      model: 'qwen3.6:27b',
      intervalMs: 30000,
      executor: 'artifact',
    });
  });

  it('keeps the agent executor fail-closed: no submit without a workspace', async () => {
    const api = makeAutonomyApi({ installed: false, running: false });
    await renderPanel(api);

    await click('autonomy-daemon-install-options-toggle');
    await setValue('autonomy-install-executor', 'agent');

    expect((query('autonomy-daemon-install-custom') as HTMLButtonElement).disabled).toBe(true);

    await setValue('autonomy-install-workspace', '/home/u/sandbox');
    expect((query('autonomy-daemon-install-custom') as HTMLButtonElement).disabled).toBe(false);

    await click('autonomy-daemon-install-custom');
    expect(api.serviceInstall).toHaveBeenCalledWith({
      executor: 'agent',
      workspace: '/home/u/sandbox',
    });
  });
});
