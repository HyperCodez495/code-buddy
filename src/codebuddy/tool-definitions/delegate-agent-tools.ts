/**
 * Delegate Agent Tool Definition
 *
 * OpenAI function-calling schema for `delegate_agent` — the single tool that
 * makes the built-in specialized agents (PDF, Excel, DataAnalysis, SQL, Archive,
 * SWE) reachable at runtime. The runtime adapter + provider wiring live in
 * `src/tools/registry/delegate-agent-tools.ts`.
 */

import type { CodeBuddyTool } from './types.js';

export const DELEGATE_AGENT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'delegate_agent',
    description:
      'Delegate a bounded, multi-step task to a built-in specialized agent when no single tool covers it: ' +
      'pdf (extract/analyze/search/summarize PDFs), excel (read/write/stats/merge XLSX), ' +
      'data_analysis (analyze/transform/aggregate/pivot/correlate tabular data), ' +
      'sql (query/schema/import/export databases), archive (list/extract/create zip/tar/7z), ' +
      'or swe (autonomous code edit/debug/refactor).',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['pdf', 'excel', 'data_analysis', 'sql', 'archive', 'swe'],
          description: 'Which specialized agent to delegate to.',
        },
        action: {
          type: 'string',
          description:
            'The sub-action for the agent (e.g. pdf: extract|analyze|search|summarize; ' +
            'sql: query|tables|schema|import|export; data_analysis: analyze|transform|aggregate|pivot|correlate; ' +
            'archive: list|extract|create; swe: edit|debug|refactor|run). Omit for a sensible default.',
        },
        instruction: {
          type: 'string',
          description: 'Free-form description of the task (used by swe; passed to other agents as context).',
        },
        filePath: {
          type: 'string',
          description: 'Path to the input file the agent should operate on (PDF/XLSX/CSV/archive/db).',
        },
        params: {
          type: 'object',
          description:
            'Extra action-specific parameters (e.g. { pattern } for pdf search, { query } for sql, { sheetName } for excel).',
        },
      },
      required: ['agent'],
    },
  },
};

export const DELEGATE_AGENT_TOOLS: CodeBuddyTool[] = [DELEGATE_AGENT_TOOL];
