import { isAbsolute, join, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';

interface LessonConceptRef {
  label: string;
  slug: string;
}

interface LessonConceptNode {
  id: string;
  label: string;
  lessonIds: string[];
  sources: string[];
}

interface LessonItem {
  category: LessonCategory;
  id: string;
}

interface LessonConceptGraph {
  concepts: LessonConceptNode[];
  filters: {
    category?: LessonCategory;
    concept?: string;
    includeKeywords: boolean;
    limit: number;
    query?: string;
  };
  generatedAt: number;
  lessonConcepts: Record<string, LessonConceptRef[]>;
  lessons: LessonItem[];
  relatedLessons: unknown[];
  schemaVersion: 1;
}

interface LessonVaultFile {
  content: string;
  path: string;
}

interface LessonVaultManifest {
  counts: {
    concepts: number;
    files: number;
    lessons: number;
    relations: number;
  };
  concepts: Array<{
    id: string;
    path: string;
  }>;
  entrypoints: {
    conceptsIndex: string;
    graphJson: string;
    graphMermaid: string;
    index: string;
    lessonsIndex: string;
    manifest: string;
  };
  lessons: Array<{
    id: string;
    path: string;
  }>;
  vaultSchemaVersion: 1;
}

interface LessonsTrackerModule {
  getLessonsTracker: (workDir: string) => {
    buildConceptGraph: (options: {
      category?: LessonCategory;
      concept?: string;
      includeKeywords?: boolean;
      limit?: number;
      query?: string;
    }) => LessonConceptGraph;
  };
  renderLessonConceptVaultFiles: (graph: LessonConceptGraph) => LessonVaultFile[];
}

export interface LessonsVaultPreviewOptions {
  category?: string;
  concept?: string;
  includeKeywords?: boolean;
  limit?: number;
  query?: string;
  rootDir: string;
  vaultDir?: string;
}

export interface LessonsVaultPreview {
  commands: {
    exportVault: string;
    graphJson: string;
    graphMarkdown: string;
  };
  concepts: Array<{
    id: string;
    label: string;
    lessonCount: number;
    path: string;
    sources: string[];
  }>;
  counts: LessonVaultManifest['counts'];
  entrypoints: LessonVaultManifest['entrypoints'];
  filters: LessonConceptGraph['filters'];
  generatedAt: string;
  kind: 'lessons_vault_preview';
  lessons: Array<{
    category: LessonCategory;
    conceptIds: string[];
    id: string;
    path: string;
  }>;
  rootDir: string;
  schemaVersion: 1;
  vaultDir: string;
}

const DEFAULT_VAULT_DIR = '.codebuddy/lessons-vault';

export async function buildLessonsVaultPreview(
  options: LessonsVaultPreviewOptions,
): Promise<LessonsVaultPreview | null> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return null;

  const mod = await loadCoreModule<LessonsTrackerModule>('agent/lessons-tracker.js');
  if (!mod?.getLessonsTracker || !mod.renderLessonConceptVaultFiles) return null;

  const includeKeywords = options.includeKeywords === true;
  const graph = mod.getLessonsTracker(rootDir).buildConceptGraph({
    category: normalizeCategory(options.category),
    concept: normalizeText(options.concept),
    includeKeywords,
    limit: normalizeLimit(options.limit),
    query: normalizeText(options.query),
  });
  const files = mod.renderLessonConceptVaultFiles(graph);
  const manifest = parseVaultManifest(files) ?? buildFallbackManifest(graph, files);
  const conceptPathById = new Map(manifest.concepts.map((concept) => [concept.id, concept.path]));
  const lessonPathById = new Map(manifest.lessons.map((lesson) => [lesson.id, lesson.path]));
  const vaultDir = resolve(rootDir, normalizeVaultDir(options.vaultDir));

  return {
    commands: buildLessonsVaultCommands(),
    concepts: graph.concepts.slice(0, 10).map((concept) => ({
      id: concept.id,
      label: concept.label,
      lessonCount: concept.lessonIds.length,
      path: conceptPathById.get(concept.id) ?? join('concepts', `${concept.id}.md`),
      sources: concept.sources,
    })),
    counts: manifest.counts,
    entrypoints: manifest.entrypoints,
    filters: graph.filters,
    generatedAt: new Date(graph.generatedAt).toISOString(),
    kind: 'lessons_vault_preview',
    lessons: graph.lessons.slice(0, 10).map((lesson) => ({
      category: lesson.category,
      conceptIds: (graph.lessonConcepts[lesson.id] ?? []).map((concept) => concept.slug),
      id: lesson.id,
      path: lessonPathById.get(lesson.id) ?? join('lessons', `${lesson.id}.md`),
    })),
    rootDir,
    schemaVersion: 1,
    vaultDir,
  };
}

function buildLessonsVaultCommands(): LessonsVaultPreview['commands'] {
  return {
    exportVault: `buddy lessons graph --no-keywords --vault ${DEFAULT_VAULT_DIR}`,
    graphJson: `buddy lessons graph --no-keywords --json --graph-output ${DEFAULT_VAULT_DIR}/graph.json`,
    graphMarkdown: `buddy lessons graph --no-keywords --markdown --graph-output ${DEFAULT_VAULT_DIR}/_lessons.md`,
  };
}

function parseVaultManifest(files: LessonVaultFile[]): LessonVaultManifest | null {
  const manifestFile = files.find((file) => file.path === 'manifest.json');
  if (!manifestFile) return null;
  try {
    return JSON.parse(manifestFile.content) as LessonVaultManifest;
  } catch {
    return null;
  }
}

function buildFallbackManifest(
  graph: LessonConceptGraph,
  files: LessonVaultFile[],
): LessonVaultManifest {
  return {
    counts: {
      concepts: graph.concepts.length,
      files: files.length,
      lessons: graph.lessons.length,
      relations: graph.relatedLessons.length,
    },
    concepts: graph.concepts.map((concept) => ({
      id: concept.id,
      path: join('concepts', `${concept.id}.md`),
    })),
    entrypoints: {
      conceptsIndex: '_concepts.md',
      graphJson: 'graph.json',
      graphMermaid: 'graph.mmd',
      index: 'index.md',
      lessonsIndex: '_lessons.md',
      manifest: 'manifest.json',
    },
    lessons: graph.lessons.map((lesson) => ({
      id: lesson.id,
      path: join('lessons', `${lesson.id}.md`),
    })),
    vaultSchemaVersion: 1,
  };
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeVaultDir(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_VAULT_DIR;
}

function normalizeCategory(value: string | undefined): LessonCategory | undefined {
  const upper = value?.trim().toUpperCase();
  if (upper === 'PATTERN' || upper === 'RULE' || upper === 'CONTEXT' || upper === 'INSIGHT') {
    return upper;
  }
  return undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
