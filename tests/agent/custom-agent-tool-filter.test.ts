import { describe, expect, it } from 'vitest';

import {
  buildCustomAgentToolFilter,
  hasCustomAgentToolFilter,
} from '../../src/agent/custom/custom-agent-tool-filter.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';
import type { CustomAgentConfig } from '../../src/agent/custom/custom-agent-loader.js';
import { filterTools } from '../../src/utils/tool-filter.js';

function agent(overrides: Partial<CustomAgentConfig> = {}): CustomAgentConfig {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    systemPrompt: 'prompt',
    ...overrides,
  };
}

function tool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  };
}

describe('custom agent tool filters', () => {
  it('detects whether an agent declares tool restrictions', () => {
    expect(hasCustomAgentToolFilter(agent())).toBe(false);
    expect(hasCustomAgentToolFilter(agent({ tools: ['view_file'] }))).toBe(true);
    expect(hasCustomAgentToolFilter(agent({ disabledTools: ['bash'] }))).toBe(true);
    expect(hasCustomAgentToolFilter(agent({ fleetDispatchProfile: 'review' }))).toBe(true);
  });

  it('uses agent tools as the allowlist when no CLI allowlist exists', () => {
    const filter = buildCustomAgentToolFilter(agent({
      tools: ['view_file', 'web_search'],
      disabledTools: ['delete_file'],
    }));

    expect(filter.enabledPatterns).toEqual(['view_file', 'web_search']);
    expect(filter.disabledPatterns).toEqual(['delete_file']);
  });

  it('preserves explicit CLI allowlists and adds agent disabled tools', () => {
    const filter = buildCustomAgentToolFilter(
      agent({
        tools: ['view_file'],
        disabledTools: ['delete_file', 'git_push'],
      }),
      {
        enabledPatterns: ['bash'],
        disabledPatterns: ['web_*'],
      },
    );

    expect(filter.enabledPatterns).toEqual(['bash']);
    expect(filter.disabledPatterns).toEqual(['web_*', 'delete_file', 'git_push']);
  });

  it('deduplicates repeated disabled tools', () => {
    const filter = buildCustomAgentToolFilter(
      agent({ disabledTools: ['delete_file', 'delete_file'] }),
      {
        enabledPatterns: [],
        disabledPatterns: ['delete_file'],
      },
    );

    expect(filter.disabledPatterns).toEqual(['delete_file']);
  });

  it('converts Fleet dispatch profiles into effective tool filters when tool names are known', () => {
    const filter = buildCustomAgentToolFilter(
      agent({ fleetDispatchProfile: 'safe' }),
      {
        enabledPatterns: [],
        disabledPatterns: ['git_push'],
      },
      ['view_file', 'create_file', 'bash', 'web_fetch', 'some_future_tool'],
    );

    expect(filter.enabledPatterns).toEqual(['view_file', 'web_fetch']);
    expect(filter.disabledPatterns).toEqual(['create_file', 'bash', 'some_future_tool', 'git_push']);
  });

  it('lets explicit CLI allowlists win while preserving profile denials', () => {
    const filter = buildCustomAgentToolFilter(
      agent({ fleetDispatchProfile: 'review' }),
      {
        enabledPatterns: ['view_file'],
        disabledPatterns: [],
      },
      ['view_file', 'create_file', 'web_fetch'],
    );

    expect(filter.enabledPatterns).toEqual(['view_file']);
    expect(filter.disabledPatterns).toEqual(['create_file']);
  });

  it('removes mutation and execution tools from safe profile model-facing schemas', () => {
    const availableTools = [
      'view_file',
      'create_file',
      'bash',
      'git_push',
      'web_fetch',
      'some_future_tool',
    ];
    const filter = buildCustomAgentToolFilter(
      agent({ fleetDispatchProfile: 'safe' }),
      undefined,
      availableTools,
    );

    const result = filterTools(availableTools.map(tool), filter);

    expect(result.tools.map(candidate => candidate.function.name)).toEqual([
      'view_file',
      'web_fetch',
    ]);
    expect(result.filtered).toEqual([
      'create_file',
      'bash',
      'git_push',
      'some_future_tool',
    ]);
  });

  it('removes mutation and execution tools from review profile model-facing schemas', () => {
    const availableTools = [
      'view_file',
      'create_file',
      'bash',
      'git_push',
      'web_fetch',
    ];
    const filter = buildCustomAgentToolFilter(
      agent({ fleetDispatchProfile: 'review' }),
      undefined,
      availableTools,
    );

    const result = filterTools(availableTools.map(tool), filter);

    expect(result.tools.map(candidate => candidate.function.name)).toEqual([
      'view_file',
      'web_fetch',
    ]);
    expect(result.filtered).toEqual([
      'create_file',
      'bash',
      'git_push',
    ]);
  });
});
