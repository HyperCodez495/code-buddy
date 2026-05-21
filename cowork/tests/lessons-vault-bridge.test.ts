import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { buildLessonsVaultPreview } from '../src/main/tools/lessons-vault-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('lessons vault bridge', () => {
  it('builds a readonly lessons vault preview from the core lessons graph', async () => {
    const buildConceptGraph = vi.fn(() => ({
      concepts: [
        {
          id: 'contact-discovery',
          label: 'contact discovery',
          lessonIds: ['lesson-1'],
          sources: ['wiki'],
        },
      ],
      filters: {
        includeKeywords: false,
        limit: 20,
      },
      generatedAt: Date.UTC(2026, 4, 19, 1, 0, 0),
      lessonConcepts: {
        'lesson-1': [{ label: 'contact discovery', slug: 'contact-discovery' }],
      },
      lessons: [{ category: 'PATTERN', id: 'lesson-1' }],
      relatedLessons: [{ from: 'lesson-1', to: 'lesson-2' }],
      schemaVersion: 1,
    }));
    const getLessonsTracker = vi.fn(() => ({ buildConceptGraph }));
    const renderLessonConceptVaultFiles = vi.fn(() => [
      { path: 'index.md', content: '# Lessons Vault' },
      {
        path: 'manifest.json',
        content: JSON.stringify({
          counts: {
            concepts: 1,
            files: 7,
            lessons: 1,
            relations: 1,
          },
          concepts: [{ id: 'contact-discovery', path: 'concepts/contact-discovery.md' }],
          entrypoints: {
            conceptsIndex: '_concepts.md',
            graphJson: 'graph.json',
            graphMermaid: 'graph.mmd',
            index: 'index.md',
            lessonsIndex: '_lessons.md',
            manifest: 'manifest.json',
          },
          lessons: [{ id: 'lesson-1', path: 'lessons/lesson-1.md' }],
          vaultSchemaVersion: 1,
        }),
      },
    ]);
    mockedLoadCoreModule.mockResolvedValue({
      getLessonsTracker,
      renderLessonConceptVaultFiles,
    });

    const rootDir = path.resolve('workspace');
    const preview = await buildLessonsVaultPreview({
      includeKeywords: false,
      rootDir,
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/lessons-tracker.js');
    expect(getLessonsTracker).toHaveBeenCalledWith(rootDir);
    expect(buildConceptGraph).toHaveBeenCalledWith({
      category: undefined,
      concept: undefined,
      includeKeywords: false,
      limit: 20,
      query: undefined,
    });
    expect(renderLessonConceptVaultFiles).toHaveBeenCalledTimes(1);
    expect(preview).toEqual(expect.objectContaining({
      kind: 'lessons_vault_preview',
      rootDir,
      schemaVersion: 1,
    }));
    expect(preview?.counts).toEqual({
      concepts: 1,
      files: 7,
      lessons: 1,
      relations: 1,
    });
    expect(preview?.concepts[0]).toEqual({
      id: 'contact-discovery',
      label: 'contact discovery',
      lessonCount: 1,
      path: 'concepts/contact-discovery.md',
      sources: ['wiki'],
    });
    expect(preview?.lessons[0]).toEqual({
      category: 'PATTERN',
      conceptIds: ['contact-discovery'],
      id: 'lesson-1',
      path: 'lessons/lesson-1.md',
    });
    expect(preview?.commands.exportVault).toBe(
      'buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault',
    );
  });

  it('rejects relative workspace roots before loading the core module', async () => {
    const preview = await buildLessonsVaultPreview({
      rootDir: 'relative-workspace',
    });

    expect(preview).toBeNull();
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('degrades to null when the core lessons module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(buildLessonsVaultPreview({
      rootDir: path.resolve('workspace'),
    })).resolves.toBeNull();
  });
});
