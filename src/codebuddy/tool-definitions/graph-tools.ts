/**
 * Graph Tool Definitions — CodeExplorer Knowledge Graph
 *
 * OpenAI function calling schemas for:
 * - analyze_impact: Blast radius analysis for symbol changes
 * - detect_processes: Find execution flows in the codebase
 * - find_communities: Detect architectural modules/clusters
 */

import type { CodeBuddyTool } from './types.js';

export const ANALYZE_IMPACT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'analyze_impact',
    description: 'Analyze the blast radius of changing a symbol in the codebase. Shows affected symbols with risk levels (high/medium/low), affected files, affected processes, and overall risk assessment. Use "up" to find callers, "down" to find callees, or "both" for full blast radius.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Symbol name or partial name to analyze (e.g., "handleLogin", "CodeBuddyAgent", "src/agent/codebuddy-agent")',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'both'],
          description: 'Analysis direction: "up" (who calls this), "down" (what this calls), "both" (full blast radius). Default: both',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum traversal depth (default: 5)',
        },
      },
      required: ['target'],
    },
  },
};

export const DETECT_PROCESSES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'detect_processes',
    description: 'Detect execution flows (processes) in the codebase by finding entry points and tracing call chains via BFS. Each process is a named sequence of function calls starting from an entry point. Use this to understand how data flows through the system.',
    parameters: {
      type: 'object',
      properties: {
        entryPoint: {
          type: 'string',
          description: 'Specific entry point to trace from (optional — omit to detect all processes)',
        },
        minSteps: {
          type: 'number',
          description: 'Minimum number of steps to qualify as a process (default: 3)',
        },
      },
      required: [],
    },
  },
};

export const FIND_COMMUNITIES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'find_communities',
    description: 'Detect architectural modules (communities) in the codebase using label propagation. Groups closely-related symbols into clusters, showing cohesion scores and entry points. Useful for understanding the modular structure and identifying tightly-coupled components.',
    parameters: {
      type: 'object',
      properties: {
        minSize: {
          type: 'number',
          description: 'Minimum number of symbols per community (default: 3)',
        },
      },
      required: [],
    },
  },
};

export const GRAPH_TOOLS: CodeBuddyTool[] = [
  ANALYZE_IMPACT_TOOL,
  DETECT_PROCESSES_TOOL,
  FIND_COMMUNITIES_TOOL,
];
