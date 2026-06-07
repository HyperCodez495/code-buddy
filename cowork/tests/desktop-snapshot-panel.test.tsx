/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSnapshotPanel } from '../src/renderer/components/DesktopSnapshotPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) => value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template
      );
    },
  }),
}));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DesktopSnapshotPanel', () => {
  let root: Root | null = null;

  function container() {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  }

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('captures a desktop snapshot and renders annotated refs', async () => {
    const status = vi.fn().mockResolvedValue({ ok: true, platform: 'win32', methods: ['hybrid', 'ocr'] });
    const capture = vi.fn().mockResolvedValue({
      ok: true,
      method: 'hybrid',
      snapshot: {
        id: 'snap-1',
        timestamp: '2026-06-07T18:00:00.000Z',
        source: 'focused',
        screenSize: { width: 1920, height: 1080 },
        valid: true,
        ttl: 30000,
        elements: [
          {
            ref: 1,
            role: 'button',
            name: 'Save',
            bounds: { x: 40, y: 50, width: 90, height: 32 },
            center: { x: 85, y: 66 },
            interactive: true,
            focused: false,
            enabled: true,
            visible: true,
          },
        ],
      },
      text: '# UI Snapshot\n\n[1] Save',
      annotatedImage: {
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
        format: 'png',
        width: 400,
        height: 240,
      },
    });

    (
      window as unknown as {
        electronAPI?: { desktopSnapshot: { status: typeof status; capture: typeof capture } };
      }
    ).electronAPI = {
      desktopSnapshot: { status, capture },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(DesktopSnapshotPanel, { onClose: () => {} }));
      await flush();
    });

    expect(status).toHaveBeenCalledTimes(1);

    const button = target.querySelector('[data-testid="desktop-snapshot-capture"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(button);
      await flush();
    });

    expect(capture).toHaveBeenCalledWith({
      method: 'hybrid',
      interactiveOnly: true,
      includeAnnotatedImage: true,
      cropAnnotatedImage: true,
      ttlMs: 30000,
    });
    expect(target.querySelector('[data-testid="desktop-snapshot-image"]')).toBeTruthy();
    expect(target.querySelector('[data-testid="desktop-snapshot-element"]')?.textContent).toContain('Save');

    const copy = target.querySelector('[data-testid="desktop-snapshot-copy-context"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(copy);
      await flush();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# UI Snapshot\n\n[1] Save');
  });

  it('shows a bridge error when desktop snapshot is unavailable', async () => {
    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(DesktopSnapshotPanel, { onClose: () => {} }));
      await flush();
    });

    expect(target.querySelector('[data-testid="desktop-snapshot-error"]')?.textContent).toContain(
      'Desktop snapshot bridge is not available.'
    );
  });
});
