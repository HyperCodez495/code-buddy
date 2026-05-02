/**
 * Phase K — PluginConflictDetector wired into PluginManager.loadPlugin tests.
 *
 * Validates that the conflict detector blocks problematic plugin loads
 * and warns on non-blocker conflicts.
 *
 * Tests use the detector directly (unit) — full PluginManager integration
 * test is heavier (filesystem + manifest.json + dynamic import) and is
 * out of scope for V0.3 wake. The unit tests cover the detector's
 * decision logic; the wirage in plugin-manager.ts is a thin call.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PluginConflictDetector,
  resetPluginConflictDetector,
  type Plugin,
} from '../../src/plugins/conflict-detection.js';

function makePlugin(id: string, deps: string[] = []): Plugin {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    dependencies: deps,
  };
}

describe('PluginConflictDetector (Phase K wake)', () => {
  let detector: PluginConflictDetector;

  beforeEach(() => {
    resetPluginConflictDetector();
    detector = new PluginConflictDetector(['view_file', 'bash', 'create_file']);
  });

  it('returns no conflicts for a fresh plugin with unique ID', () => {
    const report = detector.checkConflicts(makePlugin('my-cool-plugin'));
    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
  });

  it('BLOCKER — plugin ID matches a built-in tool name', () => {
    const report = detector.checkConflicts(makePlugin('view_file'));
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'plugin_id_vs_tool')).toBe(true);
    expect(report.conflicts[0].message).toContain('built-in tool');
  });

  it('BLOCKER — plugin ID matches built-in tool case-insensitively', () => {
    const report = detector.checkConflicts(makePlugin('VIEW_FILE'));
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'plugin_id_vs_tool')).toBe(true);
  });

  it('BLOCKER — duplicate plugin ID after one is registered', () => {
    // Note: register implies internal state mutation; we use the internal
    // map directly through register() helper if available, or inspect API
    // — for this unit test, we'll register one then try checking the same ID.
    const first = makePlugin('my-plugin');
    detector.registerPlugin(first);

    const report = detector.checkConflicts(makePlugin('my-plugin'));
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'duplicate_tool')).toBe(true);
  });

  it('NON-BLOCKER — missing dependency reports the conflict but is not blocker-class', () => {
    const report = detector.checkConflicts(makePlugin('my-plugin', ['missing-dep']));
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'dependency_missing')).toBe(true);
    // The plugin-manager wirage filters by type === 'plugin_id_vs_tool' or
    // 'duplicate_tool' for blocker; this dependency_missing is NOT in that set
    // so the wirage will warn + proceed (not abort).
    const blockers = report.conflicts.filter(
      (c) => c.type === 'plugin_id_vs_tool' || c.type === 'duplicate_tool'
    );
    expect(blockers).toHaveLength(0);
  });

  it('multiple conflicts: aggregates all into the report', () => {
    detector.registerPlugin(makePlugin('existing'));
    const report = detector.checkConflicts(makePlugin('existing', ['missing-dep']));
    expect(report.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(report.conflicts.some((c) => c.type === 'duplicate_tool')).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'dependency_missing')).toBe(true);
  });

  it('clean plugin with satisfied dependency passes', () => {
    detector.registerPlugin(makePlugin('base-lib'));
    const report = detector.checkConflicts(makePlugin('extension', ['base-lib']));
    expect(report.hasConflicts).toBe(false);
  });
});
