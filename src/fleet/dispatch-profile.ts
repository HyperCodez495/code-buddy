/**
 * Fleet dispatch profiles inspired by Hermes-style operating postures.
 *
 * Profiles are intentionally small hints today: routing nudges, peer
 * dispatch metadata, and lightweight system guidance. They are also the
 * natural future boundary for filtered toolsets.
 */

import type {
  PolicyAction,
  PolicyConfig,
  PolicyProfile,
  PolicyRule,
  PolicySource,
  ToolGroup,
} from '../security/tool-policy/types.js';
import type { ToolFilterConfig } from '../utils/tool-filter.js';
import { DEFAULT_POLICY_CONFIG } from '../security/tool-policy/types.js';
import { PolicyResolver } from '../security/tool-policy/policy-resolver.js';
import { getToolGroups } from '../security/tool-policy/tool-groups.js';

export const FLEET_DISPATCH_PROFILES = [
  'balanced',
  'research',
  'code',
  'review',
  'safe',
] as const;

export const DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS = [
  'view_file',
  'create_file',
  'bash',
  'git_push',
  'web_search',
  'web_fetch',
  'delete_file',
] as const;

export type FleetDispatchProfile = (typeof FLEET_DISPATCH_PROFILES)[number];

export interface FleetDispatchToolPolicy {
  profile: FleetDispatchProfile;
  policyProfile: PolicyProfile;
  defaultAction: PolicyAction;
  allowGroups: ToolGroup[];
  confirmGroups: ToolGroup[];
  denyGroups: ToolGroup[];
  summary: string;
}

export interface FleetDispatchProfileGuidance {
  profile: FleetDispatchProfile;
  label: string;
  useWhen: string;
  policySummary: string;
}

export interface FleetDispatchToolDecision {
  tool: string;
  groups: ToolGroup[];
  action: PolicyAction;
  source: PolicySource;
  reason: string;
  matchedGroup?: ToolGroup;
}

export interface FleetHermesToolsetDescriptor {
  profile: FleetDispatchProfile;
  toolsetId: string;
  label: string;
  intent: string;
  policyProfile: PolicyProfile;
  defaultAction: PolicyAction;
  allowGroups: ToolGroup[];
  confirmGroups: ToolGroup[];
  denyGroups: ToolGroup[];
  allowedTools: string[];
  confirmTools: string[];
  deniedTools: string[];
  decisions: FleetDispatchToolDecision[];
  summary: string;
  systemPrompt: string;
}

const FLEET_DISPATCH_PROFILE_SET = new Set<string>(FLEET_DISPATCH_PROFILES);

export function normalizeDispatchProfile(value: unknown): FleetDispatchProfile {
  return typeof value === 'string' && FLEET_DISPATCH_PROFILE_SET.has(value)
    ? (value as FleetDispatchProfile)
    : 'balanced';
}

export function isFleetDispatchProfile(value: unknown): value is FleetDispatchProfile {
  return typeof value === 'string' && FLEET_DISPATCH_PROFILE_SET.has(value);
}

const TOOL_POLICIES: Record<FleetDispatchProfile, FleetDispatchToolPolicy> = {
  balanced: {
    profile: 'balanced',
    policyProfile: 'coding',
    defaultAction: 'confirm',
    allowGroups: [
      'group:fs:read',
      'group:fs:write',
      'group:web',
      'group:git:read',
      'group:system:info',
    ],
    confirmGroups: [
      'group:runtime:shell',
      'group:git:write',
      'group:fs:delete',
      'group:mcp',
      'group:plugin',
      'group:dangerous',
    ],
    denyGroups: [],
    summary: 'Balanced coding posture: edit files, confirm command/git-write/dangerous actions.',
  },
  research: {
    profile: 'research',
    policyProfile: 'messaging',
    defaultAction: 'confirm',
    allowGroups: [
      'group:fs:read',
      'group:web',
      'group:git:read',
      'group:system:info',
    ],
    confirmGroups: [
      'group:fs:write',
      'group:mcp',
      'group:plugin',
    ],
    denyGroups: [
      'group:fs:delete',
      'group:runtime:process',
      'group:git:write',
      'group:system:modify',
      'group:docker',
      'group:kubernetes',
      'group:dangerous',
    ],
    summary: 'Research posture: gather context broadly, avoid mutation and infrastructure changes.',
  },
  code: {
    profile: 'code',
    policyProfile: 'coding',
    defaultAction: 'confirm',
    allowGroups: [
      'group:fs:read',
      'group:fs:write',
      'group:web:fetch',
      'group:web:search',
      'group:git:read',
      'group:system:info',
    ],
    confirmGroups: [
      'group:runtime:shell',
      'group:fs:delete',
      'group:git:write',
      'group:system:modify',
      'group:docker',
      'group:kubernetes',
      'group:mcp',
      'group:plugin',
      'group:dangerous',
    ],
    denyGroups: [],
    summary: 'Code posture: allow development edits, confirm execution and irreversible operations.',
  },
  review: {
    profile: 'review',
    policyProfile: 'minimal',
    defaultAction: 'confirm',
    allowGroups: [
      'group:fs:read',
      'group:web:search',
      'group:git:read',
      'group:system:info',
    ],
    confirmGroups: [
      'group:web:fetch',
      'group:mcp',
      'group:plugin',
    ],
    denyGroups: [
      'group:fs:write',
      'group:fs:delete',
      'group:runtime',
      'group:git:write',
      'group:system:modify',
      'group:docker',
      'group:kubernetes',
      'group:dangerous',
    ],
    summary: 'Review posture: read-first, no code mutation, no runtime execution by default.',
  },
  safe: {
    profile: 'safe',
    policyProfile: 'minimal',
    defaultAction: 'deny',
    allowGroups: [
      'group:fs:read',
      'group:web:search',
      'group:git:read',
      'group:system:info',
    ],
    confirmGroups: [
      'group:web:fetch',
      'group:mcp',
      'group:plugin',
    ],
    denyGroups: [
      'group:fs:write',
      'group:fs:delete',
      'group:runtime',
      'group:git:write',
      'group:system:modify',
      'group:docker',
      'group:kubernetes',
      'group:dangerous',
    ],
    summary: 'Safe posture: read-only by default, deny mutation and execution unless explicitly widened.',
  },
};

const POLICY_RULE_PRIORITIES: Record<PolicyAction, number> = {
  deny: 90,
  confirm: 80,
  allow: 70,
};

const POLICY_ACTION_VERBS: Record<PolicyAction, string> = {
  deny: 'denies',
  confirm: 'confirms',
  allow: 'allows',
};

const HERMES_TOOLSET_INTENTS: Record<FleetDispatchProfile, { label: string; intent: string }> = {
  balanced: {
    label: 'Hermes-style Fleet balanced toolset',
    intent: 'General Fleet delegation with edits enabled and confirmation for shell, git write, and dangerous actions.',
  },
  research: {
    label: 'Hermes-style Fleet research toolset',
    intent: 'Source-aware investigation with broad read/web access and mutation kept behind confirmation or denial.',
  },
  code: {
    label: 'Hermes-style Fleet code toolset',
    intent: 'Implementation-focused delegation with file writes enabled and risky execution still confirmed.',
  },
  review: {
    label: 'Hermes-style Fleet review toolset',
    intent: 'Read-first code review and audit work with code mutation and runtime execution denied.',
  },
  safe: {
    label: 'Hermes-style Fleet safe toolset',
    intent: 'Conservative read-only-by-default work where unknown tools, mutation, and execution are denied.',
  },
};

export const FLEET_DISPATCH_PROFILE_GUIDANCE: Record<
  FleetDispatchProfile,
  FleetDispatchProfileGuidance
> = {
  balanced: {
    profile: 'balanced',
    label: 'Balanced',
    useWhen: 'general delegation, mixed tasks, or unclear posture',
    policySummary: TOOL_POLICIES.balanced.summary,
  },
  research: {
    profile: 'research',
    label: 'Research',
    useWhen: 'source-aware investigation, context gathering, and low-mutation analysis',
    policySummary: TOOL_POLICIES.research.summary,
  },
  code: {
    profile: 'code',
    label: 'Code',
    useWhen: 'implementation, refactoring, tests, and development edits',
    policySummary: TOOL_POLICIES.code.summary,
  },
  review: {
    profile: 'review',
    label: 'Review',
    useWhen: 'read-first code review, audit, regression, and missing-test analysis',
    policySummary: TOOL_POLICIES.review.summary,
  },
  safe: {
    profile: 'safe',
    label: 'Safe',
    useWhen: 'high-risk, secret-bearing, destructive, or read-only-by-default work',
    policySummary: TOOL_POLICIES.safe.summary,
  },
};

export function formatDispatchProfileSelectionGuide(): string {
  return FLEET_DISPATCH_PROFILES
    .map((profile) => {
      const guidance = FLEET_DISPATCH_PROFILE_GUIDANCE[profile];
      return `${guidance.profile}: ${guidance.useWhen}`;
    })
    .join('; ');
}

export const FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT = formatDispatchProfileSelectionGuide();

function buildGroupRules(
  profile: FleetDispatchProfile,
  action: PolicyAction,
  groups: ToolGroup[],
): PolicyRule[] {
  return groups.map((group) => ({
    group,
    action,
    priority: POLICY_RULE_PRIORITIES[action],
    reason: `Fleet dispatch profile "${profile}" ${POLICY_ACTION_VERBS[action]} ${group}`,
  }));
}

export function getDispatchToolPolicy(
  profile: FleetDispatchProfile = 'balanced',
): FleetDispatchToolPolicy {
  const policy = TOOL_POLICIES[normalizeDispatchProfile(profile)];
  return {
    ...policy,
    allowGroups: [...policy.allowGroups],
    confirmGroups: [...policy.confirmGroups],
    denyGroups: [...policy.denyGroups],
  };
}

export function getDispatchPolicyRules(
  profile: FleetDispatchProfile = 'balanced',
): PolicyRule[] {
  const policy = getDispatchToolPolicy(profile);
  return [
    ...buildGroupRules(policy.profile, 'deny', policy.denyGroups),
    ...buildGroupRules(policy.profile, 'confirm', policy.confirmGroups),
    ...buildGroupRules(policy.profile, 'allow', policy.allowGroups),
  ];
}

export function buildDispatchPolicyConfig(
  profile: FleetDispatchProfile = 'balanced',
): PolicyConfig {
  const policy = getDispatchToolPolicy(profile);
  return {
    ...DEFAULT_POLICY_CONFIG,
    activeProfile: policy.policyProfile,
    defaultAction: policy.defaultAction,
    globalRules: getDispatchPolicyRules(policy.profile),
  };
}

export function previewDispatchToolDecisions(
  profile: FleetDispatchProfile = 'balanced',
  tools: readonly string[],
): FleetDispatchToolDecision[] {
  const resolver = new PolicyResolver(buildDispatchPolicyConfig(profile));
  return tools.map((tool) => {
    const decision = resolver.resolve(tool);
    const preview: FleetDispatchToolDecision = {
      tool,
      groups: getToolGroups(tool),
      action: decision.action,
      source: decision.source,
      reason: decision.reason,
    };
    if (decision.rule?.group) {
      preview.matchedGroup = decision.rule.group;
    }
    return preview;
  });
}

export function getDispatchRunnableTools(
  profile: FleetDispatchProfile = 'balanced',
  tools: readonly string[],
): string[] {
  return previewDispatchToolDecisions(profile, tools)
    .filter((decision) => decision.action !== 'deny')
    .map((decision) => decision.tool);
}

export function buildDispatchToolFilter(
  profile: FleetDispatchProfile = 'balanced',
  tools: readonly string[],
): ToolFilterConfig {
  const decisions = previewDispatchToolDecisions(profile, tools);
  return {
    enabledPatterns: decisions
      .filter((decision) => decision.action !== 'deny')
      .map((decision) => decision.tool),
    disabledPatterns: decisions
      .filter((decision) => decision.action === 'deny')
      .map((decision) => decision.tool),
  };
}

export function buildHermesToolsetDescriptor(
  profile: FleetDispatchProfile = 'balanced',
  tools: readonly string[] = DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
): FleetHermesToolsetDescriptor {
  const normalizedProfile = normalizeDispatchProfile(profile);
  const toolPolicy = getDispatchToolPolicy(normalizedProfile);
  const decisions = previewDispatchToolDecisions(normalizedProfile, tools);
  const profileIntent = HERMES_TOOLSET_INTENTS[normalizedProfile];

  return {
    profile: normalizedProfile,
    toolsetId: `fleet.hermes.${normalizedProfile}`,
    label: profileIntent.label,
    intent: profileIntent.intent,
    policyProfile: toolPolicy.policyProfile,
    defaultAction: toolPolicy.defaultAction,
    allowGroups: toolPolicy.allowGroups,
    confirmGroups: toolPolicy.confirmGroups,
    denyGroups: toolPolicy.denyGroups,
    allowedTools: decisions
      .filter((decision) => decision.action === 'allow')
      .map((decision) => decision.tool),
    confirmTools: decisions
      .filter((decision) => decision.action === 'confirm')
      .map((decision) => decision.tool),
    deniedTools: decisions
      .filter((decision) => decision.action === 'deny')
      .map((decision) => decision.tool),
    decisions,
    summary: toolPolicy.summary,
    systemPrompt: buildDispatchSystemPrompt(normalizedProfile),
  };
}

export function buildDispatchSystemPrompt(profile: FleetDispatchProfile = 'balanced'): string {
  const toolPolicy = getDispatchToolPolicy(profile);
  const base = 'Answer this delegated Fleet task clearly. Do not use tools.';
  const policyHint = ` Tool policy hint: ${toolPolicy.summary}`;
  switch (profile) {
    case 'research':
      return `${base} Prioritize context gathering, uncertainty notes, and source-aware reasoning.${policyHint}`;
    case 'code':
      return `${base} Prioritize concrete implementation guidance, touched files, and verification steps.${policyHint}`;
    case 'review':
      return `${base} Prioritize defects, risks, regressions, and missing tests before summary.${policyHint}`;
    case 'safe':
      return `${base} Be conservative: protect secrets, flag destructive actions, and prefer reversible steps.${policyHint}`;
    case 'balanced':
    default:
      return `${base}${policyHint}`;
  }
}

export function mergeDispatchSystemPrompt(
  systemPrompt: string | undefined,
  profile: FleetDispatchProfile,
): string {
  const policyPrompt = buildDispatchSystemPrompt(profile);
  if (!systemPrompt || systemPrompt.length === 0) {
    return policyPrompt;
  }
  if (systemPrompt.includes('Tool policy hint:')) {
    return systemPrompt;
  }
  return `${systemPrompt.trimEnd()}\n\n${policyPrompt}`;
}
