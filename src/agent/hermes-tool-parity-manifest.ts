export type HermesToolParityStatus = 'exact' | 'native-equivalent' | 'partial' | 'gap';

export interface HermesOfficialToolReference {
  name: string;
  toolset: string;
  category: string;
  officialSource: string;
  equivalentCodeBuddyTools?: string[];
  equivalenceStatus?: Extract<HermesToolParityStatus, 'native-equivalent' | 'partial'>;
  notes: string;
  nextWork?: string;
}

export interface HermesToolParityEntry extends HermesOfficialToolReference {
  status: HermesToolParityStatus;
  detectedCodeBuddyTools: string[];
  missingExpectedCodeBuddyTools: string[];
}

export interface HermesToolParityManifest {
  kind: 'hermes_official_tool_parity_manifest';
  schemaVersion: 1;
  generatedAt: string;
  officialSource: {
    repository: string;
    docs: string;
    inspectedCommit: string;
    latestTagObserved: string;
    sourceFiles: string[];
  };
  codeBuddySource: {
    localToolCount: number;
    localToolNames: string[];
  };
  summary: {
    total: number;
    exact: number;
    nativeEquivalent: number;
    partial: number;
    gaps: number;
  };
  tools: HermesToolParityEntry[];
}

const OFFICIAL_SOURCE_TOOLSETS = 'toolsets.py';
const OFFICIAL_SOURCE_BROWSER_DIALOG = 'tools/browser_dialog_tool.py';
const OFFICIAL_SOURCE_HOMEASSISTANT = 'tools/homeassistant_tool.py';
const OFFICIAL_SOURCE_MOA = 'tools/mixture_of_agents_tool.py';
const OFFICIAL_SOURCE_SPOTIFY = 'plugins/spotify/tools.py';
const OFFICIAL_SOURCE_X_SEARCH = 'tools/x_search_tool.py';
const OFFICIAL_SOURCE_FEISHU_DOC = 'tools/feishu_doc_tool.py';
const OFFICIAL_SOURCE_FEISHU_DRIVE = 'tools/feishu_drive_tool.py';
const OFFICIAL_SOURCE_DISCORD = 'tools/discord_tool.py';
const OFFICIAL_SOURCE_IMAGE_GENERATION = 'tools/image_generation_tool.py';
const OFFICIAL_SOURCE_VIDEO_GENERATION = 'tools/video_generation_tool.py';
const OFFICIAL_SOURCE_YUANBAO = 'tools/yuanbao_tools.py';
const OFFICIAL_SOURCE_SKILL_MANAGER = 'tools/skill_manager_tool.py';

const OFFICIAL_HERMES_TOOLS: HermesOfficialToolReference[] = [
  {
    name: 'web_search',
    toolset: 'hermes-core',
    category: 'web',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Official Hermes core web search tool.',
  },
  {
    name: 'web_extract',
    toolset: 'hermes-core',
    category: 'web',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes web_extract as a Hermes-compatible alias for the existing web_fetch extraction path.',
  },
  {
    name: 'terminal',
    toolset: 'hermes-core',
    category: 'runtime',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes terminal as a Hermes-compatible alias for the existing bash tool and its safety checks.',
  },
  {
    name: 'process',
    toolset: 'hermes-core',
    category: 'runtime',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Process management has the same tool name in Code Buddy.',
  },
  {
    name: 'read_file',
    toolset: 'hermes-core',
    category: 'file',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes read_file as a Hermes-compatible alias for view_file.',
  },
  {
    name: 'write_file',
    toolset: 'hermes-core',
    category: 'file',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes write_file as a Hermes-compatible alias for create_file.',
  },
  {
    name: 'patch',
    toolset: 'hermes-core',
    category: 'file',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes patch as a Hermes-compatible alias for str_replace_editor.',
  },
  {
    name: 'search_files',
    toolset: 'hermes-core',
    category: 'file',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes search_files as a Hermes-compatible alias for the unified search tool.',
  },
  {
    name: 'vision_analyze',
    toolset: 'hermes-core',
    category: 'media',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['ocr', 'screenshot', 'camera_snapshot'],
    notes: 'Code Buddy exposes an exact vision_analyze prompt tool for local image metadata, dominant color, labels, persisted reports, and optional local OCR evidence.',
    nextWork: 'Add model-backed semantic captioning only when provider configuration explicitly allows remote vision.',
  },
  {
    name: 'image_generate',
    toolset: 'hermes-core',
    category: 'media',
    officialSource: OFFICIAL_SOURCE_IMAGE_GENERATION,
    notes: 'Code Buddy exposes the exact image_generate prompt tool over configured OpenAI/xAI-compatible image endpoints and caches generated media when providers return b64 or downloadable URLs.',
    nextWork: 'Add GUI provider-readiness controls in Cowork if image generation becomes a daily workflow.',
  },
  {
    name: 'skills_list',
    toolset: 'hermes-core',
    category: 'skills',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a read-only skills_list prompt tool backed by the local SkillsHub lockfile.',
  },
  {
    name: 'skill_view',
    toolset: 'hermes-core',
    category: 'skills',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a read-only skill_view prompt tool backed by SkillsHub.info, including SKILL.md content and integrity metadata.',
  },
  {
    name: 'skill_manage',
    toolset: 'hermes-core',
    category: 'skills',
    officialSource: OFFICIAL_SOURCE_SKILL_MANAGER,
    equivalentCodeBuddyTools: ['skills_list', 'skill_view', 'create_skill', 'skill_discover'],
    notes: 'Code Buddy exposes the exact skill_manage prompt tool name with the official create/edit/patch/delete/write_file/remove_file action surface and official content/old_string/new_string/replace_all/file_path aliases, plus native preview_update, review-gated lifecycle, rollback, update, discovery, and candidate review extensions.',
    nextWork: 'Keep mutations review-gated and continue tracking wider CLI hub/tap/trust parity at the product-surface level.',
  },
  {
    name: 'browser_navigate',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_navigate prompt tool backed by the shared Playwright browser session.',
  },
  {
    name: 'browser_snapshot',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_snapshot prompt tool backed by the real browser accessibility snapshot engine.',
  },
  {
    name: 'browser_click',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_click prompt tool that clicks numeric refs from browser_snapshot.',
  },
  {
    name: 'browser_type',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_type prompt tool that types into numeric refs from browser_snapshot.',
  },
  {
    name: 'browser_scroll',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_scroll prompt tool backed by the shared Playwright browser session.',
  },
  {
    name: 'browser_back',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_back prompt tool backed by the shared Playwright browser session.',
  },
  {
    name: 'browser_press',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_press prompt tool backed by the shared Playwright browser session.',
  },
  {
    name: 'browser_get_images',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_get_images prompt tool backed by the active Playwright page image elements.',
  },
  {
    name: 'browser_vision',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['browser', 'screenshot'],
    notes: 'Code Buddy exposes an exact browser_vision prompt tool that captures a real Playwright screenshot, analyzes it locally, and can include accessibility snapshot context.',
  },
  {
    name: 'browser_console',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a dedicated browser_console prompt tool for listing and clearing captured Playwright console messages and page runtime errors.',
  },
  {
    name: 'browser_cdp',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['browser'],
    notes: 'Code Buddy browser can connect to CDP through cdpUrl.',
  },
  {
    name: 'browser_dialog',
    toolset: 'hermes-core',
    category: 'browser',
    officialSource: OFFICIAL_SOURCE_BROWSER_DIALOG,
    notes: 'Code Buddy exposes a dedicated browser_dialog prompt tool for listing, accepting, and dismissing native Playwright dialogs on the active browser page.',
  },
  {
    name: 'text_to_speech',
    toolset: 'hermes-core',
    category: 'media',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['audio'],
    notes: 'Code Buddy exposes an exact text_to_speech prompt tool that writes a real local speech audio file and returns a MEDIA path using detected/configured providers.',
    nextWork: 'Add provider-readiness status per TTS backend and live provider smokes as credentials or binaries are configured.',
  },
  {
    name: 'todo',
    toolset: 'hermes-core',
    category: 'planning',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['todo_update', 'create_todo_list', 'get_todo_list', 'update_todo_list'],
    notes: 'Code Buddy splits todo operations across dedicated tools.',
  },
  {
    name: 'memory',
    toolset: 'hermes-core',
    category: 'memory',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['remember', 'recall', 'forget', 'user_model_recall'],
    notes: 'Code Buddy splits memory and user-model behavior across review-gated tools.',
  },
  {
    name: 'session_search',
    toolset: 'hermes-core',
    category: 'memory',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['sessions_history', 'recall'],
    notes: 'Code Buddy now exposes an exact session_search prompt tool backed by the real saved-session store with SQLite FTS and JSON fallback.',
  },
  {
    name: 'clarify',
    toolset: 'hermes-core',
    category: 'interaction',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['ask_human', 'ask_user_question'],
    notes: 'Code Buddy has both free-form and structured ask-user tools.',
  },
  {
    name: 'execute_code',
    toolset: 'hermes-core',
    category: 'runtime',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['run_script', 'js_repl'],
    notes: 'Code Buddy exposes an exact execute_code prompt tool with real local subprocess execution, timeout, and persisted script/stdout/stderr/result artifacts; run_script remains the Docker-isolated path.',
    nextWork: 'Add optional tool-RPC collapse only if the product/security model explicitly approves tool invocation from generated code.',
  },
  {
    name: 'delegate_task',
    toolset: 'hermes-core',
    category: 'delegation',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['peer_delegate', 'peer_chain', 'spawn_parallel_agents'],
    notes: 'Code Buddy delegation is native through Fleet and session/subagent tools.',
  },
  {
    name: 'cronjob',
    toolset: 'hermes-core',
    category: 'scheduler',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes a native cronjob prompt tool backed by the persisted CronScheduler store for list/show/create/pause/resume/run/remove.',
  },
  {
    name: 'send_message',
    toolset: 'hermes-core',
    category: 'messaging',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes an exact send_message prompt tool with dry-run outbox logging by default and live delivery gated by approval plus channel send policy.',
    nextWork: 'Add live smoke tests for each configured external channel as credentials become available.',
  },
  {
    name: 'ha_list_entities',
    toolset: 'homeassistant',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_HOMEASSISTANT,
    notes: 'Code Buddy exposes the exact ha_list_entities prompt tool over the Home Assistant REST API with domain/area filtering.',
  },
  {
    name: 'ha_get_state',
    toolset: 'homeassistant',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_HOMEASSISTANT,
    notes: 'Code Buddy exposes the exact ha_get_state prompt tool over the Home Assistant REST API with entity_id validation.',
  },
  {
    name: 'ha_list_services',
    toolset: 'homeassistant',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_HOMEASSISTANT,
    notes: 'Code Buddy exposes the exact ha_list_services prompt tool over the Home Assistant REST API with compact service metadata.',
  },
  {
    name: 'ha_call_service',
    toolset: 'homeassistant',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_HOMEASSISTANT,
    notes: 'Code Buddy exposes the exact ha_call_service prompt tool over the Home Assistant REST API with blocked dangerous service domains.',
    nextWork: 'Add live Home Assistant credential smoke coverage when a real HASS_URL/HASS_TOKEN pair is configured.',
  },
  {
    name: 'kanban_show',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
    nextWork: 'Dogfood board usage in multi-agent sessions and add Cowork rendering if needed.',
  },
  {
    name: 'kanban_list',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_complete',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_block',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_heartbeat',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_comment',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_create',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_link',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'kanban_unblock',
    toolset: 'kanban',
    category: 'coordination',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    notes: 'Code Buddy exposes this exact Kanban prompt tool against a persistent workspace board.',
  },
  {
    name: 'computer_use',
    toolset: 'computer_use',
    category: 'desktop',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['computer_control'],
    notes: 'Code Buddy exposes desktop control through computer_control.',
  },
  {
    name: 'x_search',
    toolset: 'x_search',
    category: 'web',
    officialSource: OFFICIAL_SOURCE_X_SEARCH,
    notes: 'Code Buddy exposes the exact x_search prompt tool over the xAI Responses API with handle/date validation, citation extraction, retry handling, and degraded-result signaling.',
    nextWork: 'Add a live xAI smoke test when XAI_API_KEY or a usable Grok/xAI credential is configured.',
  },
  {
    name: 'video_analyze',
    toolset: 'video',
    category: 'media',
    officialSource: OFFICIAL_SOURCE_TOOLSETS,
    equivalentCodeBuddyTools: ['video'],
    notes: 'Code Buddy exposes the exact video_analyze prompt tool: local/remote video normalization, base64 video_url payload construction, size/type checks, and OpenAI-compatible video-capable model dispatch.',
  },
  {
    name: 'video_generate',
    toolset: 'video_gen',
    category: 'media',
    officialSource: OFFICIAL_SOURCE_VIDEO_GENERATION,
    notes: 'Code Buddy exposes the exact video_generate prompt tool for text-to-video and image-to-video using configured xAI or FAL-compatible HTTP backends, with returned videos cached when downloadable.',
    nextWork: 'Add provider picker/readiness UX in Cowork and live credential smoke tests when XAI_API_KEY or FAL_KEY is configured.',
  },
  {
    name: 'mixture_of_agents',
    toolset: 'moa',
    category: 'reasoning',
    officialSource: OFFICIAL_SOURCE_MOA,
    equivalentCodeBuddyTools: ['peer_chain', 'advisor', 'reason'],
    notes: 'Code Buddy exposes the exact mixture_of_agents prompt tool over an OpenRouter-compatible chat completions API with parallel reference calls and aggregator synthesis.',
    nextWork: 'Add live OpenRouter smoke coverage when OPENROUTER_API_KEY is available; keep the model list configurable.',
  },
  {
    name: 'discord',
    toolset: 'discord',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_DISCORD,
    notes: 'Code Buddy exposes an exact discord prompt tool for core Discord REST actions: fetch_messages, search_members, and create_thread.',
    nextWork: 'Add live Discord credential smoke coverage when a real bot token and guild are available.',
  },
  {
    name: 'discord_admin',
    toolset: 'discord_admin',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_DISCORD,
    notes: 'Code Buddy exposes the exact discord_admin prompt tool for Discord REST server actions: guild/channel/role/member/pin inspection plus approval-gated pin, unpin, delete-message, add-role, and remove-role mutations.',
    nextWork: 'Add live Discord credential smoke coverage when a real bot token and disposable guild are available.',
  },
  {
    name: 'spotify_playback',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify playback prompt tool over the Spotify Web API.',
    nextWork: 'Add live Spotify smoke coverage when a real SPOTIFY_ACCESS_TOKEN with playback scopes is configured.',
  },
  {
    name: 'spotify_devices',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify devices prompt tool over the Spotify Web API.',
  },
  {
    name: 'spotify_queue',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify queue prompt tool over the Spotify Web API.',
  },
  {
    name: 'spotify_search',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify catalog search prompt tool over the Spotify Web API.',
  },
  {
    name: 'spotify_playlists',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify playlists prompt tool over the Spotify Web API.',
  },
  {
    name: 'spotify_albums',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify albums prompt tool over the Spotify Web API.',
  },
  {
    name: 'spotify_library',
    toolset: 'spotify',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_SPOTIFY,
    notes: 'Code Buddy exposes the exact Spotify library prompt tool over the Spotify Web API.',
  },
  {
    name: 'feishu_doc_read',
    toolset: 'feishu',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_FEISHU_DOC,
    notes: 'Code Buddy exposes the exact Feishu/Lark document raw-content prompt tool over the Open API.',
  },
  {
    name: 'feishu_drive_list_comments',
    toolset: 'feishu',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_FEISHU_DRIVE,
    notes: 'Code Buddy exposes the exact Feishu/Lark drive comment listing prompt tool over the Open API.',
  },
  {
    name: 'feishu_drive_list_comment_replies',
    toolset: 'feishu',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_FEISHU_DRIVE,
    notes: 'Code Buddy exposes the exact Feishu/Lark drive comment replies prompt tool over the Open API.',
  },
  {
    name: 'feishu_drive_reply_comment',
    toolset: 'feishu',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_FEISHU_DRIVE,
    notes: 'Code Buddy exposes the exact Feishu/Lark drive comment reply prompt tool over the Open API.',
  },
  {
    name: 'feishu_drive_add_comment',
    toolset: 'feishu',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_FEISHU_DRIVE,
    notes: 'Code Buddy exposes the exact Feishu/Lark drive whole-document comment prompt tool over the Open API.',
  },
  {
    name: 'yb_query_group_info',
    toolset: 'yuanbao',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_YUANBAO,
    notes: 'Code Buddy exposes the exact Yuanbao group-info prompt tool over a configured Yuanbao-compatible gateway adapter.',
  },
  {
    name: 'yb_query_group_members',
    toolset: 'yuanbao',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_YUANBAO,
    notes: 'Code Buddy exposes the exact Yuanbao group-member prompt tool, including member search, bot listing, full listing, and mention-format guidance.',
  },
  {
    name: 'yb_send_dm',
    toolset: 'yuanbao',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_YUANBAO,
    notes: 'Code Buddy exposes the exact Yuanbao DM prompt tool over a configured gateway adapter, with Code Buddy approval gating for external delivery.',
    nextWork: 'Add live Yuanbao credential smoke coverage when a disposable gateway adapter is configured.',
  },
  {
    name: 'yb_search_sticker',
    toolset: 'yuanbao',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_YUANBAO,
    notes: 'Code Buddy exposes the exact Yuanbao sticker-search prompt tool over a configured gateway adapter, with a small local fallback catalog for offline discovery.',
  },
  {
    name: 'yb_send_sticker',
    toolset: 'yuanbao',
    category: 'platform',
    officialSource: OFFICIAL_SOURCE_YUANBAO,
    notes: 'Code Buddy exposes the exact Yuanbao sticker-send prompt tool over a configured gateway adapter, with Code Buddy approval gating for external delivery.',
    nextWork: 'Add live Yuanbao credential smoke coverage when a disposable gateway adapter is configured.',
  },
];

function summarizeTools(tools: readonly HermesToolParityEntry[]): HermesToolParityManifest['summary'] {
  return tools.reduce(
    (acc, tool) => {
      acc.total += 1;
      if (tool.status === 'exact') acc.exact += 1;
      else if (tool.status === 'native-equivalent') acc.nativeEquivalent += 1;
      else if (tool.status === 'partial') acc.partial += 1;
      else if (tool.status === 'gap') acc.gaps += 1;
      return acc;
    },
    { total: 0, exact: 0, nativeEquivalent: 0, partial: 0, gaps: 0 },
  );
}

function classifyTool(
  reference: HermesOfficialToolReference,
  localToolNames: ReadonlySet<string>,
): HermesToolParityEntry {
  const equivalents = reference.equivalentCodeBuddyTools ?? [];
  const detectedEquivalentTools = equivalents.filter((tool) => localToolNames.has(tool));
  const missingExpectedCodeBuddyTools = equivalents.filter((tool) => !localToolNames.has(tool));
  const detectedCodeBuddyTools = localToolNames.has(reference.name)
    ? [reference.name, ...detectedEquivalentTools.filter((tool) => tool !== reference.name)]
    : detectedEquivalentTools;

  let status: HermesToolParityStatus;
  if (localToolNames.has(reference.name)) {
    status = reference.equivalenceStatus === 'partial' ? 'partial' : 'exact';
  } else if (equivalents.length > 0 && missingExpectedCodeBuddyTools.length === 0) {
    status = reference.equivalenceStatus ?? 'native-equivalent';
  } else if (detectedEquivalentTools.length > 0 || reference.equivalenceStatus === 'partial') {
    status = 'partial';
  } else {
    status = 'gap';
  }

  return {
    ...reference,
    equivalentCodeBuddyTools: [...equivalents],
    status,
    detectedCodeBuddyTools,
    missingExpectedCodeBuddyTools,
  };
}

export function buildHermesToolParityManifest(
  localToolNames: readonly string[],
  generatedAt: string = new Date().toISOString(),
): HermesToolParityManifest {
  const localToolSet = new Set(localToolNames);
  const localToolNamesSorted = [...localToolSet].sort((a, b) => a.localeCompare(b));
  const tools = OFFICIAL_HERMES_TOOLS
    .map((reference) => classifyTool(reference, localToolSet))
    .sort((a, b) => {
      const statusOrder: Record<HermesToolParityStatus, number> = {
        gap: 0,
        partial: 1,
        'native-equivalent': 2,
        exact: 3,
      };
      return statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name);
    });

  return {
    kind: 'hermes_official_tool_parity_manifest',
    schemaVersion: 1,
    generatedAt,
    officialSource: {
      repository: 'https://github.com/NousResearch/hermes-agent',
      docs: 'https://hermes-agent.nousresearch.com/docs/reference/tools-reference',
      inspectedCommit: '5921d667',
      latestTagObserved: 'v2026.5.29.2',
      sourceFiles: [
        'toolsets.py::_HERMES_CORE_TOOLS',
        'toolsets.py::TOOLSETS',
        OFFICIAL_SOURCE_BROWSER_DIALOG,
        OFFICIAL_SOURCE_HOMEASSISTANT,
        OFFICIAL_SOURCE_MOA,
        OFFICIAL_SOURCE_SPOTIFY,
        OFFICIAL_SOURCE_X_SEARCH,
        OFFICIAL_SOURCE_FEISHU_DOC,
        OFFICIAL_SOURCE_FEISHU_DRIVE,
        OFFICIAL_SOURCE_DISCORD,
        OFFICIAL_SOURCE_IMAGE_GENERATION,
        OFFICIAL_SOURCE_VIDEO_GENERATION,
        OFFICIAL_SOURCE_YUANBAO,
        OFFICIAL_SOURCE_SKILL_MANAGER,
      ],
    },
    codeBuddySource: {
      localToolCount: localToolNamesSorted.length,
      localToolNames: localToolNamesSorted,
    },
    summary: summarizeTools(tools),
    tools,
  };
}

export function renderHermesToolParityManifestMarkdown(manifest: HermesToolParityManifest): string {
  const lines = [
    '# Hermes Official Tool Parity Manifest',
    '',
    `- Schema version: \`${manifest.schemaVersion}\``,
    `- Generated: \`${manifest.generatedAt}\``,
    `- Official repo: ${manifest.officialSource.repository}`,
    `- Official docs: ${manifest.officialSource.docs}`,
    `- Inspected commit: \`${manifest.officialSource.inspectedCommit}\``,
    `- Latest tag observed: \`${manifest.officialSource.latestTagObserved}\``,
    `- Official source files: ${manifest.officialSource.sourceFiles.map((file) => `\`${file}\``).join(', ')}`,
    `- Local Code Buddy tool count: ${manifest.codeBuddySource.localToolCount}`,
    '',
    '## Summary',
    '',
    `- Total official tools tracked: ${manifest.summary.total}`,
    `- Exact tool names: ${manifest.summary.exact}`,
    `- Native equivalents: ${manifest.summary.nativeEquivalent}`,
    `- Partial coverage: ${manifest.summary.partial}`,
    `- Gaps: ${manifest.summary.gaps}`,
    '',
    '## Tools',
    '',
  ];

  for (const tool of manifest.tools) {
    lines.push(`### ${tool.name}`);
    lines.push('');
    lines.push(`- Status: \`${tool.status}\``);
    lines.push(`- Toolset: \`${tool.toolset}\``);
    lines.push(`- Category: \`${tool.category}\``);
    lines.push(`- Official source: \`${tool.officialSource}\``);
    lines.push(
      `- Code Buddy tools: ${
        tool.detectedCodeBuddyTools.length > 0
          ? tool.detectedCodeBuddyTools.map((name) => `\`${name}\``).join(', ')
          : 'none'
      }`,
    );
    if (tool.missingExpectedCodeBuddyTools.length > 0) {
      lines.push(
        `- Missing expected Code Buddy tools: ${tool.missingExpectedCodeBuddyTools
          .map((name) => `\`${name}\``)
          .join(', ')}`,
      );
    }
    lines.push(`- Notes: ${tool.notes}`);
    if (tool.nextWork) {
      lines.push(`- Next work: ${tool.nextWork}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
