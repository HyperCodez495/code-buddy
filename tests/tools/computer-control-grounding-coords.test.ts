/**
 * Tests for the vision-grounding coordinate resolver.
 *
 * A coordinates-based grounding provider returns a point in the normalised
 * 0–1000 space. resolveGroundingCoordinatesToAbsolute() must convert valid
 * points to absolute pixels and reject non-finite / out-of-range values so a
 * misbehaving provider can never produce an off-screen or NaN click target.
 */

import { vi } from 'vitest';

const { mockSnapshotManager } = vi.hoisted(() => {
  const mockSnapshotManager = {
    getElement: vi.fn(),
    takeSnapshot: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    toTextRepresentation: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn(),
  };
  return { mockSnapshotManager };
});

jest.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: jest.fn().mockReturnValue({
    getScreenSize: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  }),
  getPermissionManager: jest.fn().mockReturnValue({ check: jest.fn(), getInstructions: jest.fn() }),
  getSystemControl: jest.fn().mockReturnValue({}),
  getSmartSnapshotManager: jest.fn().mockReturnValue(mockSnapshotManager),
  getScreenRecorder: jest.fn().mockReturnValue({ start: jest.fn(), stop: jest.fn(), getStatus: jest.fn() }),
}));

import { describe, expect, it } from 'vitest';
import { resolveGroundingCoordinatesToAbsolute } from '../../src/tools/computer-control-tool.js';

describe('resolveGroundingCoordinatesToAbsolute', () => {
  const screen = { width: 1920, height: 1080 };

  it('scales valid normalised coordinates to absolute pixels', () => {
    expect(resolveGroundingCoordinatesToAbsolute({ x: 500, y: 500 }, screen)).toEqual({ x: 960, y: 540 });
    expect(resolveGroundingCoordinatesToAbsolute({ x: 0, y: 0 }, screen)).toEqual({ x: 0, y: 0 });
    expect(resolveGroundingCoordinatesToAbsolute({ x: 1000, y: 1000 }, screen)).toEqual({ x: 1920, y: 1080 });
  });

  it('falls back to a 1920x1080 screen when no size is provided', () => {
    expect(resolveGroundingCoordinatesToAbsolute({ x: 250, y: 750 })).toEqual({ x: 480, y: 810 });
    expect(resolveGroundingCoordinatesToAbsolute({ x: 100, y: 100 }, { width: 0, height: -5 })).toEqual({
      x: 192,
      y: 108,
    });
  });

  it('rejects out-of-range coordinates instead of clicking off-screen', () => {
    expect(resolveGroundingCoordinatesToAbsolute({ x: 1200, y: 500 }, screen)).toBeNull();
    expect(resolveGroundingCoordinatesToAbsolute({ x: 500, y: 1001 }, screen)).toBeNull();
    expect(resolveGroundingCoordinatesToAbsolute({ x: -1, y: 500 }, screen)).toBeNull();
    expect(resolveGroundingCoordinatesToAbsolute({ x: 500, y: -0.5 }, screen)).toBeNull();
  });

  it('rejects non-finite coordinates', () => {
    expect(resolveGroundingCoordinatesToAbsolute({ x: NaN, y: 500 }, screen)).toBeNull();
    expect(resolveGroundingCoordinatesToAbsolute({ x: 500, y: Infinity }, screen)).toBeNull();
    expect(resolveGroundingCoordinatesToAbsolute({ x: -Infinity, y: -Infinity }, screen)).toBeNull();
  });
});
