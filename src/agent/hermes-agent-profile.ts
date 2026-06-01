/**
 * Native Hermes-inspired agent profile for Code Buddy.
 *
 * This does not vendor Hermes Agent. It maps the product pattern onto
 * Code Buddy primitives: Fleet toolsets, skills, memory, session search,
 * scheduled work and peer delegation.
 */

import {
  FLEET_DISPATCH_PROFILES,
  FLEET_DISPATCH_PROFILE_GUIDANCE,
  FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT,
  buildHermesToolsetDescriptor,
  normalizeDispatchProfile,
  type FleetDispatchProfile,
  type FleetDispatchProfileGuidance,
  type FleetHermesToolsetDescriptor,
} from '../fleet/dispatch-profile.js';

export interface HermesNativeSurface {
  id: string;
  label: string;
  codeBuddySurface: string;
  purpose: string;
}

export interface HermesRuntimeMapping {
  implementation: 'code-buddy-native';
  codeBuddyRuntime: 'typescript-fleet';
  upstreamRuntime: 'not-vendored';
  upstreamLanguage: 'python';
  compatibilityMode: 'semantic-mapping';
  boundary: string;
}

export interface HermesAgentProfile {
  id: 'hermes';
  name: 'Hermes Agent';
  description: string;
  runtimeMapping: HermesRuntimeMapping;
  defaultDispatchProfile: FleetDispatchProfile;
  dispatchProfileGuidance: FleetDispatchProfileGuidance[];
  toolsets: FleetHermesToolsetDescriptor[];
  nativeSurfaces: HermesNativeSurface[];
  operatingRules: string[];
}

export interface HermesIntegrationPlanItem {
  id: string;
  title: string;
  kind: 'inspect' | 'verify' | 'prepare' | 'execute';
  risk: 'read-only' | 'local-write' | 'interactive';
  nativeSurfaceId: string;
  command: string;
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  purpose: string;
  doneWhen: string;
}

export interface HermesInteractionSurface {
  id: 'cli' | 'cowork' | 'shared-json';
  label: string;
  entrypoint: string;
  primaryAction: string;
  secondaryActions: string[];
  consumes: string[];
  produces: string[];
}

export interface HermesIntegrationPlan {
  id: 'hermes-integration-plan';
  planSchemaVersion: 1;
  generatedAt: string;
  summary: string;
  dispatchProfile: FleetDispatchProfile;
  toolsetId: string;
  recommendedNextCommand: string;
  surfaceIds: string[];
  interactionSurfaces: HermesInteractionSurface[];
  items: HermesIntegrationPlanItem[];
}

export const HERMES_RUNTIME_MAPPING: HermesRuntimeMapping = {
  implementation: 'code-buddy-native',
  codeBuddyRuntime: 'typescript-fleet',
  upstreamRuntime: 'not-vendored',
  upstreamLanguage: 'python',
  compatibilityMode: 'semantic-mapping',
  boundary: 'Hermes Agent concepts are mapped onto Code Buddy TypeScript/Fleet primitives; the upstream Python runtime is not embedded or impersonated.',
};

export const HERMES_NATIVE_SURFACES: HermesNativeSurface[] = [
  {
    id: 'toolsets',
    label: 'Toolsets',
    codeBuddySurface: 'buddy fleet toolsets, route_peer, peer_delegate, peer.chat*',
    purpose: 'Expose named tool availability postures per profile and per task.',
  },
  {
    id: 'skills',
    label: 'Skills',
    codeBuddySurface: 'SKILL.md packages and src/skills/hub.ts',
    purpose: 'Keep procedural know-how in reusable skill packages instead of bloating every prompt.',
  },
  {
    id: 'memory',
    label: 'Memory',
    codeBuddySurface: '.codebuddy/CODEBUDDY_MEMORY.md and project/user memory stores',
    purpose: 'Persist durable facts and preferences outside volatile chat history.',
  },
  {
    id: 'lessons',
    label: 'Lessons Graph',
    codeBuddySurface: 'lessons_graph and buddy lessons graph --vault <dir>',
    purpose: 'Turn learned corrections into a navigable concept graph and generated Obsidian-style vault.',
  },
  {
    id: 'session-search',
    label: 'Session Search',
    codeBuddySurface: 'session repository search and --search-sessions',
    purpose: 'Recover previous work evidence without injecting all old conversations.',
  },
  {
    id: 'scheduled-work',
    label: 'Scheduled Work',
    codeBuddySurface: 'Cowork scheduled Fleet dispatches and heartbeat automations',
    purpose: 'Run fresh, self-contained agent tasks with explicit prompt and metadata.',
  },
  {
    id: 'hooks',
    label: 'Lifecycle Hooks',
    codeBuddySurface: 'buddy hermes hooks and .codebuddy/hooks.json user-hook events',
    purpose: 'Attach guardrails and observability to tool calls, memory writes, run completion and scheduled delivery.',
  },
  {
    id: 'delegation',
    label: 'Delegation',
    codeBuddySurface: 'Fleet peers, peer_delegate, /agents, /swarm',
    purpose: 'Route bounded work to isolated peers or subagents with profile metadata.',
  },
];

export function buildHermesAgentProfile(
  defaultDispatchProfile: FleetDispatchProfile = 'balanced',
): HermesAgentProfile {
  const profile = normalizeDispatchProfile(defaultDispatchProfile);
  return {
    id: 'hermes',
    name: 'Hermes Agent',
    description:
      'Hermes-inspired Code Buddy profile for durable, toolset-aware autonomous work without leaving the TypeScript/Fleet runtime.',
    runtimeMapping: { ...HERMES_RUNTIME_MAPPING },
    defaultDispatchProfile: profile,
    dispatchProfileGuidance: FLEET_DISPATCH_PROFILES.map((dispatchProfile) => ({
      ...FLEET_DISPATCH_PROFILE_GUIDANCE[dispatchProfile],
    })),
    toolsets: FLEET_DISPATCH_PROFILES.map((dispatchProfile) => (
      buildHermesToolsetDescriptor(dispatchProfile)
    )),
    nativeSurfaces: HERMES_NATIVE_SURFACES.map((surface) => ({ ...surface })),
    operatingRules: [
      'Choose an explicit Fleet dispatch profile before delegating or scheduling work.',
      'Use skills for repeatable procedures, memory for stable facts, and session search for old evidence.',
      'Use lessons_graph or the generated lessons vault when the task depends on prior corrections or nearby concepts.',
      'Keep scheduled prompts self-contained because scheduled jobs run without the live chat context.',
      'Delegate only bounded work, and carry the selected toolset/profile into peer calls.',
      'Prefer resolver-backed toolset metadata over hand-maintained allowlists.',
    ],
  };
}

export function buildHermesAgentSystemPrompt(
  defaultDispatchProfile: FleetDispatchProfile = 'balanced',
): string {
  const profile = buildHermesAgentProfile(defaultDispatchProfile);
  const activeToolset = buildHermesToolsetDescriptor(profile.defaultDispatchProfile);
  const surfaces = profile.nativeSurfaces
    .map((surface) => `- ${surface.label}: ${surface.codeBuddySurface} - ${surface.purpose}`)
    .join('\n');
  const rules = profile.operatingRules.map((rule) => `- ${rule}`).join('\n');

  return [
    'You are Hermes Agent inside Code Buddy.',
    '',
    'Operate as a durable, toolset-aware autonomous coding agent using Code Buddy native primitives.',
    'Do not pretend to be the external Hermes Python runtime; translate the Hermes pattern onto Code Buddy.',
    '',
    `Default Fleet toolset: ${activeToolset.toolsetId}`,
    `Default posture: ${activeToolset.summary}`,
    '',
    'Dispatch profile selection:',
    FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT,
    '',
    'Native surfaces:',
    surfaces,
    '',
    'Operating rules:',
    rules,
    '',
    'When planning or delegating, name the selected dispatch profile and keep the task self-contained.',
  ].join('\n');
}

export function buildHermesIntegrationPlan(
  defaultDispatchProfile: FleetDispatchProfile = 'balanced',
): HermesIntegrationPlan {
  const profile = buildHermesAgentProfile(defaultDispatchProfile);
  const activeToolset = buildHermesToolsetDescriptor(profile.defaultDispatchProfile);

  return {
    id: 'hermes-integration-plan',
    planSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: 'Prepare Hermes Agent for bounded, toolset-aware Code Buddy work with memory and lessons context.',
    dispatchProfile: profile.defaultDispatchProfile,
    toolsetId: activeToolset.toolsetId,
    recommendedNextCommand: `buddy hermes doctor ${profile.defaultDispatchProfile} --json`,
    surfaceIds: ['toolsets', 'delegation', 'lessons'],
    interactionSurfaces: buildHermesInteractionSurfaces(profile.defaultDispatchProfile, activeToolset.toolsetId),
    items: [
      {
        id: 'inspect-profile',
        title: 'Inspect the Hermes runtime mapping',
        kind: 'inspect',
        risk: 'read-only',
        nativeSurfaceId: 'toolsets',
        command: `buddy hermes profile ${profile.defaultDispatchProfile} --json`,
        expectedArtifacts: [],
        acceptanceCriteria: [
          'The profile JSON uses the requested dispatch profile.',
          'The active toolset descriptors include the selected fleet.hermes profile.',
        ],
        purpose: 'Confirm the selected Fleet posture, toolsets, and native Code Buddy surfaces.',
        doneWhen: 'The profile JSON lists the expected dispatch profile and toolset descriptors.',
      },
      {
        id: 'verify-agent',
        title: 'Verify the effective Hermes agent',
        kind: 'verify',
        risk: 'read-only',
        nativeSurfaceId: 'delegation',
        command: `buddy hermes doctor ${profile.defaultDispatchProfile} --json`,
        expectedArtifacts: [],
        acceptanceCriteria: [
          'Diagnostics return ok or only documented recommendations.',
          'The effective tool filter and dispatch profile are visible before delegation.',
        ],
        purpose: 'Check whether the built-in Hermes profile or a local override will be used.',
        doneWhen: 'Diagnostics are ok or recommendations have been reviewed before delegation.',
      },
      {
        id: 'export-lessons-vault',
        title: 'Export a navigable lessons vault',
        kind: 'prepare',
        risk: 'local-write',
        nativeSurfaceId: 'lessons',
        command: 'buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault',
        expectedArtifacts: [
          '.codebuddy/lessons-vault/index.md',
          '.codebuddy/lessons-vault/_concepts.md',
          '.codebuddy/lessons-vault/_lessons.md',
          '.codebuddy/lessons-vault/graph.json',
          '.codebuddy/lessons-vault/graph.mmd',
          '.codebuddy/lessons-vault/manifest.json',
        ],
        acceptanceCriteria: [
          'The generated vault includes a manifest.json file.',
          'The manifest maps lessons and concepts to generated files.',
          'Fallback keyword concepts are disabled for a clean explicit-link/tag graph.',
        ],
        purpose: 'Give humans and UI consumers a stable map of learned corrections and nearby concepts.',
        doneWhen: 'The vault contains index.md, _concepts.md, _lessons.md, graph.json, graph.mmd, and manifest.json.',
      },
      {
        id: 'run-hermes-agent',
        title: 'Run Hermes with a self-contained task',
        kind: 'execute',
        risk: 'interactive',
        nativeSurfaceId: 'delegation',
        command: 'buddy --agent hermes',
        expectedArtifacts: [],
        acceptanceCriteria: [
          'The task prompt names the selected dispatch profile.',
          'The final report includes verification evidence and any lessons learned.',
        ],
        purpose: 'Use the Hermes prompt and selected dispatch posture for bounded autonomous work.',
        doneWhen: 'The task names its dispatch profile, toolset posture, verification evidence, and follow-up lessons.',
      },
    ],
  };
}

function buildHermesInteractionSurfaces(
  dispatchProfile: FleetDispatchProfile,
  toolsetId: string,
): HermesInteractionSurface[] {
  return [
    {
      id: 'cli',
      label: 'CLI',
      entrypoint: `buddy hermes plan ${dispatchProfile} --json`,
      primaryAction: 'Inspect, export, script, and diff the Hermes handoff from a terminal.',
      secondaryActions: [
        `buddy hermes profile ${dispatchProfile} --json`,
        `buddy hermes doctor ${dispatchProfile} --json`,
        `buddy hermes plan ${dispatchProfile} --markdown --plan-output .codebuddy/hermes-plan.md`,
      ],
      consumes: [
        'dispatch profile',
        'Fleet toolset metadata',
        'lessons graph/vault artifacts',
      ],
      produces: [
        'stable JSON plan',
        'Markdown handoff',
        'doctor/profile diagnostics',
      ],
    },
    {
      id: 'cowork',
      label: 'Cowork',
      entrypoint: 'Fleet Command Center Hermes plan strip',
      primaryAction: 'Render the checklist, then seed a Fleet dispatch or schedule from the selected profile.',
      secondaryActions: [
        'Use as Fleet goal',
        'Schedule via Cowork scheduled dispatch',
        'Inspect saga, outcome, memory and lessons follow-up',
      ],
      consumes: [
        `toolset ${toolsetId}`,
        'Hermes checklist items',
        'risk and acceptance criteria metadata',
      ],
      produces: [
        'dispatch-ready goal text',
        'visible operator checklist',
        'saga/outcome context for memory and lessons',
      ],
    },
    {
      id: 'shared-json',
      label: 'Shared JSON',
      entrypoint: 'HermesIntegrationPlan schema',
      primaryAction: 'Keep CLI, Cowork, docs and future API surfaces on the same structured contract.',
      secondaryActions: [
        'Render text for terminal users',
        'Render Markdown for handoff notes',
        'Render checklist UI without parsing prose',
      ],
      consumes: [
        'Hermes profile metadata',
        'Fleet dispatch policy resolver output',
      ],
      produces: [
        'versioned plan schema',
        'surface map',
        'acceptance criteria per step',
      ],
    },
  ];
}

export function renderHermesIntegrationPlanMarkdown(plan: HermesIntegrationPlan): string {
  const lines = [
    `# Hermes Integration Plan (${plan.dispatchProfile})`,
    '',
    plan.summary,
    '',
    `- Plan schema version: \`${plan.planSchemaVersion}\``,
    `- Generated: \`${plan.generatedAt}\``,
    `- Toolset: \`${plan.toolsetId}\``,
    `- Recommended next command: \`${plan.recommendedNextCommand}\``,
    `- Surfaces: ${plan.surfaceIds.map((surfaceId) => `\`${surfaceId}\``).join(', ')}`,
    '',
    '## Interaction Surfaces',
    '',
  ];

  for (const surface of plan.interactionSurfaces) {
    lines.push(`### ${surface.label}`);
    lines.push('');
    lines.push(`- Entrypoint: \`${surface.entrypoint}\``);
    lines.push(`- Primary action: ${surface.primaryAction}`);
    lines.push(`- Consumes: ${surface.consumes.map((value) => `\`${value}\``).join(', ')}`);
    lines.push(`- Produces: ${surface.produces.map((value) => `\`${value}\``).join(', ')}`);
    if (surface.secondaryActions.length > 0) {
      lines.push('- Secondary actions:');
      for (const action of surface.secondaryActions) {
        lines.push(`  - ${action}`);
      }
    }
    lines.push('');
  }

  lines.push(
    '## Checklist',
    '',
  );

  for (const item of plan.items) {
    lines.push(`### ${item.title}`);
    lines.push('');
    lines.push(`- Kind: \`${item.kind}\``);
    lines.push(`- Risk: \`${item.risk}\``);
    lines.push(`- Surface: \`${item.nativeSurfaceId}\``);
    lines.push(`- Command: \`${item.command}\``);
    if (item.expectedArtifacts.length > 0) {
      lines.push('- Expected artifacts:');
      for (const artifact of item.expectedArtifacts) {
        lines.push(`  - \`${artifact}\``);
      }
    }
    lines.push('- Acceptance criteria:');
    for (const criterion of item.acceptanceCriteria) {
      lines.push(`  - ${criterion}`);
    }
    lines.push(`- Purpose: ${item.purpose}`);
    lines.push(`- Done when: ${item.doneWhen}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
