/**
 * Runtime context for the currently active custom agent.
 *
 * The custom-agent loader owns static configuration. This module carries
 * the active agent choice into tool execution, where Fleet helpers can
 * preserve agent-level dispatch posture without coupling to the CLI.
 */

import {
  normalizeDispatchProfile,
  type FleetDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import type { CustomAgentConfig } from './custom-agent-loader.js';

export type DispatchProfileSource =
  | 'explicit'
  | 'agent-default'
  | 'implicit-default';

export interface ActiveCustomAgentRuntime {
  id: string;
  name: string;
  fleetDispatchProfile?: FleetDispatchProfile;
  requireExplicitDispatchProfile?: boolean;
}

export interface DispatchProfileResolution {
  dispatchProfile: FleetDispatchProfile;
  source: DispatchProfileSource;
  agentId?: string;
}

let activeCustomAgent: ActiveCustomAgentRuntime | null = null;

export function setActiveCustomAgentRuntime(agent: CustomAgentConfig): void {
  activeCustomAgent = {
    id: agent.id,
    name: agent.name,
    fleetDispatchProfile: agent.fleetDispatchProfile
      ? normalizeDispatchProfile(agent.fleetDispatchProfile)
      : undefined,
    requireExplicitDispatchProfile: agent.requireExplicitDispatchProfile,
  };
}

export function getActiveCustomAgentRuntime(): ActiveCustomAgentRuntime | null {
  return activeCustomAgent ? { ...activeCustomAgent } : null;
}

export function resetActiveCustomAgentRuntime(): void {
  activeCustomAgent = null;
}

export function resolveActiveCustomAgentDispatchProfile(
  explicitProfile?: FleetDispatchProfile | string,
): DispatchProfileResolution {
  if (explicitProfile) {
    return {
      dispatchProfile: normalizeDispatchProfile(explicitProfile),
      source: 'explicit',
    };
  }

  if (activeCustomAgent?.fleetDispatchProfile) {
    return {
      dispatchProfile: activeCustomAgent.fleetDispatchProfile,
      source: 'agent-default',
      agentId: activeCustomAgent.id,
    };
  }

  return {
    dispatchProfile: 'balanced',
    source: 'implicit-default',
  };
}

export function shouldPropagateResolvedDispatchProfile(
  resolution: DispatchProfileResolution,
): boolean {
  return resolution.source !== 'implicit-default';
}
