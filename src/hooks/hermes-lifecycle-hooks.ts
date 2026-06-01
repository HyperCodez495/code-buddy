/**
 * Hermes lifecycle hook contract.
 *
 * This module gives Code Buddy's existing hook systems one canonical,
 * Hermes-inspired vocabulary. Runtime execution still goes through the
 * user hook manager, so no new side effects happen unless the operator
 * has explicitly configured `.codebuddy/hooks.json`.
 */

import { getToolHooksManager, type ToolHookStage } from '../tools/hooks/tool-hooks.js';
import {
  getUserHooksManager,
  type HookContext,
  type HookResult,
  type UserHookEvent,
} from './user-hooks.js';

export const HERMES_HOOK_LIFECYCLE_SCHEMA_VERSION = 1;

export type HermesHookStage =
  | 'before_tool_call'
  | 'after_tool_call'
  | 'before_memory_write'
  | 'after_run_complete'
  | 'before_scheduled_delivery';

export interface HermesHookStageDefinition {
  stage: HermesHookStage;
  label: string;
  purpose: string;
  userHookEvent: UserHookEvent;
  toolHookStage?: ToolHookStage;
  coreTouchpoint: string;
  blocksOperation: boolean;
  defaultBehavior: 'allow';
}

export interface HermesHookStageManifest extends HermesHookStageDefinition {
  configuredHandlers: number;
  registeredToolHooks: number;
  active: boolean;
}

export interface HermesHookLifecycleManifest {
  kind: 'hermes_hook_lifecycle_manifest';
  schemaVersion: typeof HERMES_HOOK_LIFECYCLE_SCHEMA_VERSION;
  generatedAt: string;
  workingDirectory: string;
  stages: HermesHookStageManifest[];
}

export const HERMES_HOOK_STAGE_DEFINITIONS: readonly HermesHookStageDefinition[] = [
  {
    stage: 'before_tool_call',
    label: 'Before tool call',
    purpose: 'Allow guardrails to inspect or block a tool call before execution.',
    userHookEvent: 'PreToolUse',
    toolHookStage: 'before_tool_call',
    coreTouchpoint: 'src/agent/execution/tool-hooks.ts',
    blocksOperation: true,
    defaultBehavior: 'allow',
  },
  {
    stage: 'after_tool_call',
    label: 'After tool call',
    purpose: 'Let observability or review hooks inspect a completed tool result.',
    userHookEvent: 'PostToolUse',
    toolHookStage: 'after_tool_call',
    coreTouchpoint: 'src/agent/execution/tool-hooks.ts',
    blocksOperation: false,
    defaultBehavior: 'allow',
  },
  {
    stage: 'before_memory_write',
    label: 'Before memory write',
    purpose: 'Review or block durable memory writes before they touch storage.',
    userHookEvent: 'BeforeMemoryWrite',
    coreTouchpoint: 'src/tools/registry/memory-tools.ts',
    blocksOperation: true,
    defaultBehavior: 'allow',
  },
  {
    stage: 'after_run_complete',
    label: 'After run complete',
    purpose: 'Observe completed, failed or cancelled runs without editing RunStore callers.',
    userHookEvent: 'AfterRunComplete',
    coreTouchpoint: 'src/observability/run-store.ts',
    blocksOperation: false,
    defaultBehavior: 'allow',
  },
  {
    stage: 'before_scheduled_delivery',
    label: 'Before scheduled delivery',
    purpose: 'Review scheduled-job delivery payloads before webhook or channel delivery.',
    userHookEvent: 'BeforeScheduledDelivery',
    coreTouchpoint: 'src/daemon/cron-agent-bridge.ts',
    blocksOperation: true,
    defaultBehavior: 'allow',
  },
];

export function buildHermesHookLifecycleManifest(
  workingDirectory = process.cwd(),
): HermesHookLifecycleManifest {
  const userHooks = getUserHooksManager(workingDirectory);
  const registeredToolHooks = getToolHooksManager().getRegisteredHooks();

  return {
    kind: 'hermes_hook_lifecycle_manifest',
    schemaVersion: HERMES_HOOK_LIFECYCLE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workingDirectory,
    stages: HERMES_HOOK_STAGE_DEFINITIONS.map((definition) => {
      const configuredHandlers = userHooks.getHandlers(definition.userHookEvent).length;
      const matchingToolHooks = definition.toolHookStage
        ? registeredToolHooks.filter((hook) => hook.stage === definition.toolHookStage).length
        : 0;
      return {
        ...definition,
        configuredHandlers,
        registeredToolHooks: matchingToolHooks,
        active: configuredHandlers > 0 || matchingToolHooks > 0,
      };
    }),
  };
}

export async function executeHermesLifecycleHook(
  workingDirectory: string,
  stage: HermesHookStage,
  context: HookContext,
): Promise<HookResult> {
  const definition = HERMES_HOOK_STAGE_DEFINITIONS.find((candidate) => candidate.stage === stage);
  if (!definition) {
    return { allowed: true };
  }

  return getUserHooksManager(workingDirectory).executeHooks(definition.userHookEvent, {
    ...context,
    hermesStage: stage,
    coreTouchpoint: definition.coreTouchpoint,
  });
}

export function renderHermesHookLifecycleManifest(manifest: HermesHookLifecycleManifest): string {
  const activeStages = manifest.stages.filter((stage) => stage.active).length;
  const blockingStages = manifest.stages.filter((stage) => stage.blocksOperation).length;
  const lines = [
    'Hermes hook lifecycle:',
    `  Schema version: ${manifest.schemaVersion}`,
    `  Workspace: ${manifest.workingDirectory}`,
    `  Active stages: ${activeStages}/${manifest.stages.length}`,
    `  Blocking stages: ${blockingStages}/${manifest.stages.length}`,
    '',
  ];

  for (const stage of manifest.stages) {
    const active = stage.active ? 'active' : 'available';
    lines.push(`${stage.label} (${stage.stage})`);
    lines.push(`  Status: ${active}`);
    lines.push(`  Active: ${stage.active ? 'yes' : 'no'}`);
    lines.push(`  Default behavior: ${stage.defaultBehavior}`);
    lines.push(`  User event: ${stage.userHookEvent}`);
    if (stage.toolHookStage) {
      lines.push(`  Tool stage: ${stage.toolHookStage}`);
    }
    lines.push(`  Configured handlers: ${stage.configuredHandlers}`);
    lines.push(`  Registered tool hooks: ${stage.registeredToolHooks}`);
    lines.push(`  Blocks operation: ${stage.blocksOperation ? 'yes' : 'no'}`);
    lines.push(`  Touchpoint: ${stage.coreTouchpoint}`);
    lines.push(`  Purpose: ${stage.purpose}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
