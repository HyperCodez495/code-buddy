/**
 * Research Tool Adapters (factory)
 *
 * Wires the research ITool adapters into the FormalToolRegistry so they are
 * DISPATCHABLE in interactive chat (via `ToolHandler.initializeRegistry`), not
 * only in headless/multi-agent runs:
 *  - `deep_research` — src/tools/deep-research-tool.ts (multi-source web research).
 *  - `paper_qa` — src/tools/paper-qa-tool.ts (grounded, cited QA over a PDF corpus).
 *
 * The adapters themselves (business delegation + conservative in-chat bounds)
 * live in those files; this factory only instantiates them.
 */

import type { ITool } from './types.js';
import { DeepResearchTool } from '../deep-research-tool.js';
import { PaperQaTool } from '../paper-qa-tool.js';

/**
 * Create all research tool instances.
 */
export function createResearchTools(): ITool[] {
  return [new DeepResearchTool(), new PaperQaTool()];
}
