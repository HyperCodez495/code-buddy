/**
 * Tool-surface gate (jarvis-OS-style baseline snapshot, 2026-07-07).
 *
 * Two invariants, born from the 2026-07-04 interconnection audit that found
 * whole tool groups exposed to the LLM but resolving to "Unknown tool" in
 * interactive chat (spotify/kanban/…):
 *
 * 1. `interactive dispatch ⊇ LLM exposition` — every built-in tool the model
 *    can see must be executable by ToolHandler's FormalToolRegistry path.
 * 2. The exposed surface matches a committed baseline — adding/removing/
 *    renaming an exposed tool is a conscious, reviewed act:
 *      npx tsx scripts/update-tool-surface-baseline.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Opt-in registrations (register_tool + persisted authored tools) must not
// leak into the surface from the developer's environment. Must run before the
// module-singleton initializeToolRegistry() below.
delete process.env.CODEBUDDY_SELF_IMPROVE;

import { initializeToolRegistry } from '../../src/codebuddy/tools.js';
import { getToolRegistry } from '../../src/tools/registry.js';
import { createInteractiveToolAdapters } from '../../src/tools/registry/interactive-adapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let exposed: string[] = [];

beforeAll(() => {
  initializeToolRegistry();
  exposed = getToolRegistry()
    .getAllTools()
    .map((t) => t.function.name)
    .sort();
});

describe('tool surface (exposition ↔ dispatch)', () => {
  it('exposes a sane number of built-in tools', () => {
    expect(exposed.length).toBeGreaterThan(100);
  });

  it('every LLM-exposed tool is dispatchable in interactive chat (dispatch ⊇ exposed)', () => {
    // Force both optional groups on: the test asserts the invariant on the
    // superset dispatch list, independent of host platform and env.
    const dispatchable = new Set(
      createInteractiveToolAdapters({
        includeWindowsTools: true,
        includeSelfImproveTools: true,
      }).map((t) => t.name),
    );
    // ToolHandler.executeTool handles these before the registry lookup.
    dispatchable.add('edit_file'); // Morph Fast Apply special-case branch

    const missing = exposed.filter((name) => !dispatchable.has(name));
    expect(
      missing,
      `Tools exposed to the LLM but NOT dispatchable in interactive chat ` +
        `(they would resolve to "Unknown tool"): ${missing.join(', ')}\n` +
        `Register a dispatch adapter in src/tools/registry/interactive-adapters.ts ` +
        `(see the 2026-07-04 interconnection-audit note in that file).`,
    ).toEqual([]);
  });

  it('exposed tool surface matches the committed baseline', () => {
    const baselinePath = path.join(__dirname, 'tool-surface.baseline.txt');
    const baseline = fs.readFileSync(baselinePath, 'utf8').split('\n').filter(Boolean);

    const baselineSet = new Set(baseline);
    const exposedSet = new Set(exposed);
    const added = exposed.filter((n) => !baselineSet.has(n));
    const removed = baseline.filter((n) => !exposedSet.has(n));

    expect(
      { added, removed },
      `Exposed tool surface drifted from tests/tools/tool-surface.baseline.txt.\n` +
        `If this change is intentional, regenerate the baseline and commit it:\n` +
        `  npx tsx scripts/update-tool-surface-baseline.ts\n` +
        `added: ${added.join(', ') || '(none)'}\nremoved: ${removed.join(', ') || '(none)'}`,
    ).toEqual({ added: [], removed: [] });
  });
});
