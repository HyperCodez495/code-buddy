/**
 * Hermes official toolset catalog.
 *
 * Upstream Hermes Agent groups its tools into named toolsets (core / composite /
 * platform / dynamic) plus per-platform presets (`hermes-cli`, `hermes-discord`,
 * `hermes-feishu`, ...). This module enumerates that official toolset catalog and
 * computes an explicit, machine-readable readiness status for each toolset by
 * REUSING the existing official tool parity manifest
 * (`hermes-tool-parity-manifest.ts`). It does not re-derive any
 * tool -> Code Buddy mapping; the per-tool status, detected Code Buddy tools and
 * missing tools all come from the manifest.
 *
 * The only new data owned here is the membership table: which official Hermes
 * tool names compose each named toolset, and which catalog group each toolset
 * belongs to. Every member tool name MUST exist in `OFFICIAL_HERMES_TOOLS`
 * (asserted by tests) so the catalog cannot drift from the manifest.
 */

import {
  buildHermesToolParityManifest,
  type HermesToolParityEntry,
  type HermesToolParityManifest,
  type HermesToolParityStatus,
} from './hermes-tool-parity-manifest.js';

export type HermesToolsetGroup = 'core' | 'composite' | 'platform' | 'dynamic';

/**
 * Readiness of a named toolset relative to its official tool membership.
 * - `present`: every member tool is exact or native-equivalent in Code Buddy.
 * - `partial`: some members are present, others are missing or only partial.
 * - `absent`: no member tool is present (or the toolset has no mapped members yet).
 */
export type HermesToolsetReadiness = 'present' | 'partial' | 'absent';

interface HermesOfficialToolsetDefinition {
  id: string;
  group: HermesToolsetGroup;
  label: string;
  /** Official Hermes tool names that compose this toolset. */
  memberTools: string[];
  /** Composite presets reference other toolset ids instead of raw tools. */
  composedOf?: string[];
  notes: string;
}

export interface HermesToolsetMemberStatus {
  tool: string;
  status: HermesToolParityStatus | 'unknown';
  detectedCodeBuddyTools: string[];
  missingExpectedCodeBuddyTools: string[];
}

export interface HermesToolsetReadinessEntry {
  id: string;
  group: HermesToolsetGroup;
  label: string;
  readiness: HermesToolsetReadiness;
  notes: string;
  composedOf: string[];
  expectedToolCount: number;
  presentToolCount: number;
  exactToolCount: number;
  partialToolCount: number;
  missingToolNames: string[];
  members: HermesToolsetMemberStatus[];
}

export interface HermesToolsetCatalogManifest {
  kind: 'hermes_official_toolset_catalog';
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  officialSource: {
    repository: string;
    docs: string;
    inspectedCommit: string;
    sourceFiles: string[];
  };
  summary: {
    totalOfficialToolsets: number;
    byGroup: Record<HermesToolsetGroup, number>;
    present: number;
    partial: number;
    absent: number;
  };
  groupingDesignNote: string;
  toolsets: HermesToolsetReadinessEntry[];
}

/**
 * Official Hermes named toolsets. Membership is reconstructed from the upstream
 * toolsets reference; every `memberTools` entry must be a name tracked in
 * `OFFICIAL_HERMES_TOOLS`. Toolsets without a Code Buddy member surface (e.g.
 * the reinforcement-learning `rl` toolset) are kept and report `absent`, which
 * is an honest readiness signal rather than a forced match.
 */
const OFFICIAL_TOOLSETS: HermesOfficialToolsetDefinition[] = [
  // --- core ---
  {
    id: 'web',
    group: 'core',
    label: 'Web fetch/extract',
    memberTools: ['web_extract'],
    notes: 'Page fetch and content extraction.',
  },
  {
    id: 'search',
    group: 'core',
    label: 'Web search',
    memberTools: ['web_search', 'x_search'],
    notes: 'Web and X/Twitter search surfaces.',
  },
  {
    id: 'terminal',
    group: 'core',
    label: 'Terminal and process control',
    memberTools: ['terminal', 'process'],
    notes: 'Shell command execution and process management.',
  },
  {
    id: 'file',
    group: 'core',
    label: 'File read/write/patch/search',
    memberTools: ['read_file', 'write_file', 'patch', 'search_files'],
    notes: 'Local filesystem read, write, patch and search.',
  },
  {
    id: 'browser',
    group: 'core',
    label: 'Headless browser automation',
    memberTools: [
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_scroll',
      'browser_back',
      'browser_press',
      'browser_get_images',
      'browser_vision',
      'browser_console',
      'browser_cdp',
      'browser_dialog',
    ],
    notes: 'Playwright-backed browser navigation, interaction and inspection.',
  },
  {
    id: 'vision',
    group: 'core',
    label: 'Image and video analysis',
    memberTools: ['vision_analyze', 'video_analyze'],
    notes: 'Local image and video analysis.',
  },
  {
    id: 'image_gen',
    group: 'core',
    label: 'Image generation',
    memberTools: ['image_generate'],
    notes: 'Provider-backed image generation.',
  },
  {
    id: 'moa',
    group: 'core',
    label: 'Mixture of agents',
    memberTools: ['mixture_of_agents'],
    notes: 'Multi-model reference/aggregator reasoning.',
  },
  {
    id: 'skills',
    group: 'core',
    label: 'Skill discovery and management',
    memberTools: ['skills_list', 'skill_view', 'skill_manage'],
    notes: 'Read-only skill listing/view plus review-gated skill management.',
  },
  {
    id: 'tts',
    group: 'core',
    label: 'Text to speech',
    memberTools: ['text_to_speech'],
    notes: 'Local speech synthesis.',
  },
  {
    id: 'video_gen',
    group: 'core',
    label: 'Video generation',
    memberTools: ['video_generate'],
    notes: 'Provider-backed text/image to video generation.',
  },
  {
    id: 'todo',
    group: 'core',
    label: 'Todo planning',
    memberTools: ['todo'],
    notes: 'Task/todo planning surface.',
  },
  {
    id: 'memory',
    group: 'core',
    label: 'Long-term memory',
    memberTools: ['memory'],
    notes: 'Persistent memory read/write.',
  },
  {
    id: 'session_search',
    group: 'core',
    label: 'Session search',
    memberTools: ['session_search'],
    notes: 'Search across prior saved sessions.',
  },
  {
    id: 'cronjob',
    group: 'core',
    label: 'Scheduling',
    memberTools: ['cronjob'],
    notes: 'Cron-style scheduled task management.',
  },
  {
    id: 'code_execution',
    group: 'core',
    label: 'Sandboxed code execution',
    memberTools: ['execute_code'],
    notes: 'Run generated code in an isolated runtime.',
  },
  {
    id: 'delegation',
    group: 'core',
    label: 'Task delegation',
    memberTools: ['delegate_task'],
    notes: 'Delegate sub-tasks to peers/subagents.',
  },
  {
    id: 'clarify',
    group: 'core',
    label: 'User clarification',
    memberTools: ['clarify'],
    notes: 'Ask the user a clarifying question.',
  },
  {
    id: 'messaging',
    group: 'core',
    label: 'Outbound messaging',
    memberTools: ['send_message'],
    notes: 'Send messages over configured channels.',
  },
  {
    id: 'computer_use',
    group: 'core',
    label: 'Desktop control',
    memberTools: ['computer_use'],
    notes: 'GUI/desktop control surface.',
  },
  {
    id: 'kanban',
    group: 'core',
    label: 'Kanban coordination',
    memberTools: [
      'kanban_show',
      'kanban_list',
      'kanban_create',
      'kanban_complete',
      'kanban_block',
      'kanban_unblock',
      'kanban_comment',
      'kanban_link',
      'kanban_heartbeat',
    ],
    notes: 'Multi-agent Kanban board coordination.',
  },
  {
    id: 'debugging',
    group: 'core',
    label: 'Debugging',
    memberTools: ['terminal', 'process', 'execute_code', 'browser_console'],
    notes: 'No dedicated upstream debugging tool maps 1:1; readiness is composed from the runtime/console surfaces Code Buddy exposes for debugging workflows.',
  },
  {
    id: 'rl',
    group: 'core',
    label: 'Reinforcement learning harness',
    memberTools: [],
    notes: 'Upstream RL/training harness toolset; no Code Buddy prompt-tool member surface exists, so this is intentionally reported absent.',
  },
  // --- platform ---
  {
    id: 'homeassistant',
    group: 'platform',
    label: 'Home Assistant',
    memberTools: ['ha_list_entities', 'ha_get_state', 'ha_list_services', 'ha_call_service'],
    notes: 'Home Assistant REST entity/state/service control.',
  },
  {
    id: 'spotify',
    group: 'platform',
    label: 'Spotify',
    memberTools: [
      'spotify_playback',
      'spotify_devices',
      'spotify_queue',
      'spotify_search',
      'spotify_playlists',
      'spotify_albums',
      'spotify_library',
    ],
    notes: 'Spotify Web API playback and catalog.',
  },
  {
    id: 'discord',
    group: 'platform',
    label: 'Discord',
    memberTools: ['discord'],
    notes: 'Core Discord REST actions.',
  },
  {
    id: 'discord_admin',
    group: 'platform',
    label: 'Discord admin',
    memberTools: ['discord_admin'],
    notes: 'Approval-gated Discord server administration.',
  },
  {
    id: 'feishu',
    group: 'platform',
    label: 'Feishu / Lark',
    memberTools: [
      'feishu_doc_read',
      'feishu_drive_list_comments',
      'feishu_drive_list_comment_replies',
      'feishu_drive_reply_comment',
      'feishu_drive_add_comment',
    ],
    notes: 'Feishu/Lark document and drive comments.',
  },
  {
    id: 'yuanbao',
    group: 'platform',
    label: 'Yuanbao',
    memberTools: [
      'yb_query_group_info',
      'yb_query_group_members',
      'yb_send_dm',
      'yb_search_sticker',
      'yb_send_sticker',
    ],
    notes: 'Yuanbao gateway group/DM/sticker actions.',
  },
  // --- composite (per-platform presets) ---
  {
    id: 'hermes-cli',
    group: 'composite',
    label: 'Hermes CLI preset',
    composedOf: ['file', 'terminal', 'search', 'web', 'code_execution', 'todo', 'memory', 'skills'],
    memberTools: [],
    notes: 'Per-platform preset for the local CLI surface; readiness is composed from its constituent core toolsets.',
  },
  {
    id: 'hermes-discord',
    group: 'composite',
    label: 'Hermes Discord preset',
    composedOf: ['discord', 'discord_admin', 'search', 'web', 'memory'],
    memberTools: [],
    notes: 'Per-platform preset for Discord operation; readiness is composed from its constituent toolsets.',
  },
  {
    id: 'hermes-feishu',
    group: 'composite',
    label: 'Hermes Feishu preset',
    composedOf: ['feishu', 'search', 'web', 'memory'],
    memberTools: [],
    notes: 'Per-platform preset for Feishu/Lark operation; readiness is composed from its constituent toolsets.',
  },
  // --- dynamic ---
  {
    id: 'safe',
    group: 'dynamic',
    label: 'Safe (read-only) dynamic toolset',
    memberTools: ['read_file', 'search_files', 'web_search', 'session_search'],
    notes: 'Conservative read-only dynamic toolset; in Code Buddy this overlaps the `fleet.hermes.safe` dispatch profile policy (see `buddy hermes toolsets safe`).',
  },
];

const EMPTY_GROUP_COUNTS: Record<HermesToolsetGroup, number> = {
  core: 0,
  composite: 0,
  platform: 0,
  dynamic: 0,
};

const STATUS_PRESENT = new Set<HermesToolParityStatus>(['exact', 'native-equivalent']);

function indexManifestTools(
  manifest: HermesToolParityManifest,
): Map<string, HermesToolParityEntry> {
  const index = new Map<string, HermesToolParityEntry>();
  for (const tool of manifest.tools) {
    index.set(tool.name, tool);
  }
  return index;
}

function resolveMemberStatus(
  tool: string,
  toolIndex: ReadonlyMap<string, HermesToolParityEntry>,
): HermesToolsetMemberStatus {
  const entry = toolIndex.get(tool);
  if (!entry) {
    return {
      tool,
      status: 'unknown',
      detectedCodeBuddyTools: [],
      missingExpectedCodeBuddyTools: [],
    };
  }
  return {
    tool,
    status: entry.status,
    detectedCodeBuddyTools: [...entry.detectedCodeBuddyTools],
    missingExpectedCodeBuddyTools: [...entry.missingExpectedCodeBuddyTools],
  };
}

function readinessFromCounts(
  expected: number,
  present: number,
): HermesToolsetReadiness {
  if (expected === 0) return 'absent';
  if (present === 0) return 'absent';
  if (present === expected) return 'present';
  return 'partial';
}

function classifyToolset(
  definition: HermesOfficialToolsetDefinition,
  toolIndex: ReadonlyMap<string, HermesToolParityEntry>,
  byId: ReadonlyMap<string, HermesToolsetReadinessEntry>,
): HermesToolsetReadinessEntry {
  const composedOf = definition.composedOf ?? [];

  if (composedOf.length > 0) {
    // Composite presets aggregate their constituent toolsets' readiness.
    const constituents = composedOf
      .map((id) => byId.get(id))
      .filter((value): value is HermesToolsetReadinessEntry => value !== undefined);
    const expectedToolCount = constituents.reduce((sum, c) => sum + c.expectedToolCount, 0);
    const presentToolCount = constituents.reduce((sum, c) => sum + c.presentToolCount, 0);
    const exactToolCount = constituents.reduce((sum, c) => sum + c.exactToolCount, 0);
    const partialToolCount = constituents.reduce((sum, c) => sum + c.partialToolCount, 0);
    const missingToolNames = constituents.flatMap((c) => c.missingToolNames);
    const members = constituents.flatMap((c) => c.members);

    return {
      id: definition.id,
      group: definition.group,
      label: definition.label,
      readiness: readinessFromCounts(expectedToolCount, presentToolCount),
      notes: definition.notes,
      composedOf: [...composedOf],
      expectedToolCount,
      presentToolCount,
      exactToolCount,
      partialToolCount,
      missingToolNames,
      members,
    };
  }

  const members = definition.memberTools.map((tool) => resolveMemberStatus(tool, toolIndex));
  const presentToolCount = members.filter(
    (m) => m.status !== 'unknown' && STATUS_PRESENT.has(m.status),
  ).length;
  const exactToolCount = members.filter((m) => m.status === 'exact').length;
  const partialToolCount = members.filter((m) => m.status === 'partial').length;
  const missingToolNames = members
    .filter((m) => m.status === 'unknown' || m.status === 'gap')
    .map((m) => m.tool);

  return {
    id: definition.id,
    group: definition.group,
    label: definition.label,
    readiness: readinessFromCounts(members.length, presentToolCount),
    notes: definition.notes,
    composedOf: [],
    expectedToolCount: members.length,
    presentToolCount,
    exactToolCount,
    partialToolCount,
    missingToolNames,
    members,
  };
}

export function buildHermesToolsetCatalog(
  localToolNames: readonly string[],
  generatedAt: string = new Date().toISOString(),
): HermesToolsetCatalogManifest {
  const manifest = buildHermesToolParityManifest(localToolNames, generatedAt);
  const toolIndex = indexManifestTools(manifest);

  // Resolve non-composite toolsets first so composite presets can aggregate them.
  const byId = new Map<string, HermesToolsetReadinessEntry>();
  for (const definition of OFFICIAL_TOOLSETS) {
    if ((definition.composedOf ?? []).length === 0) {
      byId.set(definition.id, classifyToolset(definition, toolIndex, byId));
    }
  }
  for (const definition of OFFICIAL_TOOLSETS) {
    if ((definition.composedOf ?? []).length > 0) {
      byId.set(definition.id, classifyToolset(definition, toolIndex, byId));
    }
  }

  const toolsets = OFFICIAL_TOOLSETS.map((definition) => {
    const entry = byId.get(definition.id);
    if (!entry) {
      throw new Error(`Hermes toolset catalog failed to classify "${definition.id}"`);
    }
    return entry;
  });

  const byGroup: Record<HermesToolsetGroup, number> = { ...EMPTY_GROUP_COUNTS };
  let present = 0;
  let partial = 0;
  let absent = 0;
  for (const toolset of toolsets) {
    byGroup[toolset.group] += 1;
    if (toolset.readiness === 'present') present += 1;
    else if (toolset.readiness === 'partial') partial += 1;
    else absent += 1;
  }

  return {
    kind: 'hermes_official_toolset_catalog',
    schemaVersion: 1,
    generatedAt,
    command: 'buddy hermes toolsets --catalog --json',
    officialSource: {
      repository: manifest.officialSource.repository,
      docs: manifest.officialSource.docs,
      inspectedCommit: manifest.officialSource.inspectedCommit,
      sourceFiles: ['toolsets.py::TOOLSETS', 'toolsets.py::_HERMES_CORE_TOOLS'],
    },
    summary: {
      totalOfficialToolsets: toolsets.length,
      byGroup,
      present,
      partial,
      absent,
    },
    groupingDesignNote:
      'Grouping (core/composite/platform/dynamic) and per-toolset membership are reconstructed from the upstream toolsets reference. Per-tool readiness is sourced from the official tool parity manifest, not recomputed here. Composite presets aggregate the readiness of their constituent core/platform toolsets.',
    toolsets,
  };
}

/** Stable list of official toolset ids in catalog order (for tests/tooling). */
export const OFFICIAL_HERMES_TOOLSET_IDS: readonly string[] = OFFICIAL_TOOLSETS.map(
  (toolset) => toolset.id,
);

/** All distinct member tool names referenced by the catalog (for invariant tests). */
export function listCatalogMemberToolNames(): string[] {
  const names = new Set<string>();
  for (const toolset of OFFICIAL_TOOLSETS) {
    for (const tool of toolset.memberTools) {
      names.add(tool);
    }
  }
  return [...names];
}
