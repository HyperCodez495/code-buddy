import type { CodeBuddyTool } from '../codebuddy/client.js';
import {
  CORE_TOOLS,
  MORPH_EDIT_TOOL,
  isMorphEnabled,
  SEARCH_TOOLS,
  TODO_TOOLS,
  KANBAN_TOOLS,
  MESSAGING_TOOLS,
  CRON_TOOLS,
  WEB_TOOLS,
  ADVANCED_TOOLS,
  MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS,
  BROWSER_TOOLS,
  CANVAS_TOOLS,
  AGENT_TOOLS,
  FIRECRAWL_TOOLS,
  LSP_TOOLS,
  SECRETS_TOOLS,
  ADVISOR_TOOLS,
  ASK_USER_QUESTION_TOOLS,
  EXIT_PLAN_MODE_TOOLS,
  CODEBASE_REPLACE_TOOLS,
  SESSION_TOOLS,
  GITNEXUS_TOOLS,
} from '../codebuddy/tool-definitions/index.js';
import { FLEET_TOOLS } from '../codebuddy/fleet-tool-defs.js';
import {
  buildHermesToolParityManifest,
  type HermesToolParityManifest,
} from './hermes-tool-parity-manifest.js';

export function collectOfflineBuiltinTools(): CodeBuddyTool[] {
  const groups: CodeBuddyTool[][] = [
    CORE_TOOLS,
    ...(isMorphEnabled() ? [[MORPH_EDIT_TOOL]] : []),
    SEARCH_TOOLS,
    TODO_TOOLS,
    KANBAN_TOOLS,
    MESSAGING_TOOLS,
    CRON_TOOLS,
    WEB_TOOLS,
    ADVANCED_TOOLS,
    MULTIMODAL_TOOLS,
    COMPUTER_CONTROL_TOOLS,
    BROWSER_TOOLS,
    CANVAS_TOOLS,
    AGENT_TOOLS,
    ...(process.env.FIRECRAWL_API_KEY ? [FIRECRAWL_TOOLS] : []),
    LSP_TOOLS,
    SECRETS_TOOLS,
    ADVISOR_TOOLS,
    ASK_USER_QUESTION_TOOLS,
    EXIT_PLAN_MODE_TOOLS,
    CODEBASE_REPLACE_TOOLS,
    SESSION_TOOLS,
    FLEET_TOOLS,
    GITNEXUS_TOOLS,
  ];
  const byName = new Map<string, CodeBuddyTool>();
  for (const tool of groups.flat()) {
    if (!byName.has(tool.function.name)) {
      byName.set(tool.function.name, tool);
    }
  }
  return [...byName.values()];
}

export function collectOfflineBuiltinToolNames(): string[] {
  return collectOfflineBuiltinTools().map((tool) => tool.function.name);
}

export function buildLocalHermesToolParityManifest(
  generatedAt: string = new Date().toISOString(),
): HermesToolParityManifest {
  return buildHermesToolParityManifest(collectOfflineBuiltinToolNames(), generatedAt);
}
