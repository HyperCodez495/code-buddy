import { loadCoreModule } from '../utils/core-loader';

type HermesToolParityStatus = 'exact' | 'native-equivalent' | 'partial' | 'gap';

export interface HermesToolCatalogGap {
  category: string;
  name: string;
  nextWork?: string;
  status: HermesToolParityStatus;
  toolset: string;
}

export interface HermesToolCatalogSummary {
  generatedAt: string;
  inspectedCommit: string;
  localToolCount: number;
  source: string;
  summary: {
    exact: number;
    gaps: number;
    nativeEquivalent: number;
    partial: number;
    total: number;
  };
  topWork: HermesToolCatalogGap[];
}

interface HermesToolParityEntry extends HermesToolCatalogGap {
  notes: string;
}

interface HermesToolParityManifest {
  generatedAt: string;
  officialSource: {
    inspectedCommit: string;
    repository: string;
  };
  codeBuddySource: {
    localToolCount: number;
  };
  summary: HermesToolCatalogSummary['summary'];
  tools: HermesToolParityEntry[];
}

interface HermesToolParityLocalModule {
  buildLocalHermesToolParityManifest: () => HermesToolParityManifest;
}

const PRIORITY_TOOL_NAMES = [
  'skill_manage',
  'execute_code',
  'vision_analyze',
  'browser_vision',
  'kanban_show',
  'kanban_create',
  'kanban_complete',
  'send_message',
];

export async function getHermesToolCatalogForReview(): Promise<HermesToolCatalogSummary | null> {
  const mod = await loadCoreModule<HermesToolParityLocalModule>('agent/hermes-tool-parity-local.js');
  if (!mod?.buildLocalHermesToolParityManifest) return null;

  const manifest = mod.buildLocalHermesToolParityManifest();
  const needsWork = manifest.tools.filter((tool) =>
    tool.status === 'gap' || tool.status === 'partial'
  );
  const topWork = [
    ...PRIORITY_TOOL_NAMES
      .map((name) => needsWork.find((tool) => tool.name === name))
      .filter((tool): tool is HermesToolParityEntry => Boolean(tool)),
    ...needsWork.filter((tool) => !PRIORITY_TOOL_NAMES.includes(tool.name)),
  ].slice(0, 6);

  return {
    generatedAt: manifest.generatedAt,
    inspectedCommit: manifest.officialSource.inspectedCommit,
    localToolCount: manifest.codeBuddySource.localToolCount,
    source: manifest.officialSource.repository,
    summary: manifest.summary,
    topWork: topWork.map((tool) => ({
      category: tool.category,
      name: tool.name,
      nextWork: tool.nextWork,
      status: tool.status,
      toolset: tool.toolset,
    })),
  };
}
