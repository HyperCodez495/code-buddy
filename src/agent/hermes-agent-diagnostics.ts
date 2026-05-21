/**
 * Diagnostics for the native Hermes-inspired Code Buddy profile.
 */

import type { ToolFilterConfig } from '../utils/tool-filter.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  buildHermesToolsetDescriptor,
  normalizeDispatchProfile,
  type FleetDispatchProfile,
  type FleetDispatchProfileGuidance,
  type FleetHermesToolsetDescriptor,
} from '../fleet/dispatch-profile.js';
import {
  CustomAgentLoader,
  type CustomAgentConfig,
  type CustomAgentFile,
} from './custom/custom-agent-loader.js';
import { buildCustomAgentToolFilter } from './custom/custom-agent-tool-filter.js';
import { buildHermesAgentProfile } from './hermes-agent-profile.js';

export interface HermesPromptChecks {
  mentionsCodeBuddyRuntime: boolean;
  mentionsExternalRuntimeBoundary: boolean;
  mentionsDefaultToolset: boolean;
}

export interface HermesAgentDiagnostics {
  id: 'hermes';
  ok: boolean;
  dispatchProfile: FleetDispatchProfile;
  source: 'built-in' | 'user' | 'missing';
  userOverride: boolean;
  agentFound: boolean;
  agentPath: string | null;
  agentName: string | null;
  agentDescription: string | null;
  enabledTools: string[];
  disabledTools: string[];
  fleetDispatchProfile: FleetDispatchProfile | null;
  requireExplicitDispatchProfile: boolean;
  effectiveToolFilter: ToolFilterConfig;
  activeToolset: FleetHermesToolsetDescriptor;
  dispatchProfileGuidance: FleetDispatchProfileGuidance[];
  nativeSurfaceIds: string[];
  promptChecks: HermesPromptChecks;
  issues: string[];
  recommendations: string[];
}

export interface HermesAgentDiagnosticsOptions {
  availableTools?: readonly string[];
  dispatchProfile?: FleetDispatchProfile | string;
  loader?: CustomAgentLoader;
}

const EMPTY_FILTER: ToolFilterConfig = {
  enabledPatterns: [],
  disabledPatterns: [],
};

function getHermesAgentFile(loader: CustomAgentLoader): CustomAgentFile | undefined {
  return loader.loadAgents().find((agent) => agent.config.id === 'hermes');
}

function buildPromptChecks(
  agent: CustomAgentConfig | null,
): HermesPromptChecks {
  const prompt = agent?.systemPrompt ?? '';
  return {
    mentionsCodeBuddyRuntime: prompt.includes('Code Buddy'),
    mentionsExternalRuntimeBoundary: prompt.includes('external Hermes Python runtime'),
    mentionsDefaultToolset: prompt.includes('Default Fleet toolset:'),
  };
}

export function buildHermesAgentDiagnostics(
  options: HermesAgentDiagnosticsOptions = {},
): HermesAgentDiagnostics {
  const dispatchProfile = normalizeDispatchProfile(options.dispatchProfile ?? 'balanced');
  const loader = options.loader ?? new CustomAgentLoader();
  const agentFile = getHermesAgentFile(loader);
  const agent = agentFile?.config ?? null;
  const activeToolset = buildHermesToolsetDescriptor(dispatchProfile);
  const hermesProfile = buildHermesAgentProfile(dispatchProfile);
  const availableTools = options.availableTools ?? DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS;
  const effectiveToolFilter = agent
    ? buildCustomAgentToolFilter(
      { ...agent, fleetDispatchProfile: dispatchProfile },
      EMPTY_FILTER,
      availableTools,
    )
    : EMPTY_FILTER;
  const source = !agentFile
    ? 'missing'
    : agentFile.path === 'builtin:hermes'
      ? 'built-in'
      : 'user';
  const promptChecks = buildPromptChecks(agent);
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (!agent) {
    issues.push('Hermes custom agent profile was not found.');
  }

  if (agent && !promptChecks.mentionsCodeBuddyRuntime) {
    issues.push('Hermes system prompt does not mention the Code Buddy runtime.');
  }

  if (agent && !promptChecks.mentionsExternalRuntimeBoundary) {
    recommendations.push('Mention that Hermes is mapped onto Code Buddy, not run as the external Python runtime.');
  }

  if (agent && !promptChecks.mentionsDefaultToolset) {
    recommendations.push('Mention the default Fleet toolset in the prompt.');
  }

  if (agent && effectiveToolFilter.disabledPatterns.length === 0) {
    recommendations.push('Declare disabledTools for destructive operations such as git_push or delete_file.');
  }

  return {
    id: 'hermes',
    ok: issues.length === 0,
    dispatchProfile,
    source,
    userOverride: source === 'user',
    agentFound: Boolean(agent),
    agentPath: agentFile?.path ?? null,
    agentName: agent?.name ?? null,
    agentDescription: agent?.description ?? null,
    enabledTools: agent?.tools ?? [],
    disabledTools: agent?.disabledTools ?? [],
    fleetDispatchProfile: agent?.fleetDispatchProfile ?? null,
    requireExplicitDispatchProfile: agent?.requireExplicitDispatchProfile === true,
    effectiveToolFilter,
    activeToolset,
    dispatchProfileGuidance: hermesProfile.dispatchProfileGuidance.map((guidance) => ({
      ...guidance,
    })),
    nativeSurfaceIds: hermesProfile.nativeSurfaces.map((surface) => surface.id),
    promptChecks,
    issues,
    recommendations,
  };
}
