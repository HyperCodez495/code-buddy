import { describe, expect, it } from 'vitest';
import { ProjectMemoryService } from '../src/main/project/project-memory';

describe('ProjectMemoryService semantic preview', () => {
  it('extracts deduplicated memory candidates from session text', () => {
    const service = new ProjectMemoryService({
      get: () => ({
        id: 'project-1',
        name: 'Test Project',
        workspacePath: '/tmp/project-1',
        memoryConfig: { autoConsolidate: true },
      }),
    } as never);

    const candidates = service.extractMemoryCandidates(
      [
        {
          role: 'user',
          content:
            'Please always use the embedded engine.\nWe will use the embedded engine.\nRemember this context about fast recovery.',
        },
        {
          role: 'assistant',
          content: 'Decision: chosen replay-first recovery.\nPattern: usually keep recovery markers.',
        },
      ],
      'session-1'
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((candidate) => candidate.category === 'preference')).toBe(true);
    expect(candidates.some((candidate) => candidate.category === 'decision')).toBe(true);
  });

  it('builds a project memory preview with candidate metadata', () => {
    const service = new ProjectMemoryService({
      get: () => ({
        id: 'project-1',
        name: 'Test Project',
        workspacePath: '/tmp/project-1',
        memoryConfig: { autoConsolidate: true },
      }),
    } as never);

    const preview = service.previewProjectMemory('project-1', 'session-1', [
      {
        role: 'user',
        content: 'We should always prefer stable anchors for recovery.',
      },
    ]);

    expect(preview?.projectId).toBe('project-1');
    expect(preview?.hasWorkspace).toBe(true);
    expect(preview?.candidateCount).toBe(1);
    expect(preview?.candidates[0]?.evidence).toContain('stable anchors');
  });
});
