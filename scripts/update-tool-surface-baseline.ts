/**
 * Regenerate tests/tools/tool-surface.baseline.txt — the committed snapshot of
 * every built-in tool name exposed to the LLM (jarvis-OS-style surface gate).
 *
 * Run after intentionally adding/removing/renaming an exposed tool:
 *   npx tsx scripts/update-tool-surface-baseline.ts
 *
 * The diff then lands in the same commit as the tool change, making surface
 * drift explicit in review instead of silent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Keep the surface deterministic: opt-in registrations must not leak into the
// baseline from the developer's environment.
delete process.env.CODEBUDDY_SELF_IMPROVE;

const { initializeToolRegistry } = await import('../src/codebuddy/tools.js');
const { getToolRegistry } = await import('../src/tools/registry.js');

initializeToolRegistry();
const names = getToolRegistry()
  .getAllTools()
  .map((t) => t.function.name)
  .sort();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(__dirname, '..', 'tests', 'tools', 'tool-surface.baseline.txt');
fs.writeFileSync(baselinePath, names.join('\n') + '\n', 'utf8');
console.log(`${names.length} exposed tools written to ${path.relative(process.cwd(), baselinePath)}`);
