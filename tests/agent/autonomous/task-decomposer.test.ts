import { describe, expect, it, vi } from 'vitest';
import { shouldDecompose, decomposeTask } from '../../../src/agent/autonomous/task-decomposer.js';
import type { AgenticCodingTaskContract } from '../../../src/agent/autonomous/agentic-coding-contract.js';
import type { CodeBuddyClient } from '../../../src/codebuddy/client.js';

describe('task-decomposer', () => {
  const allowedPaths = ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'];
  const contract: AgenticCodingTaskContract = {
    repo: 'D:/CascadeProjects/grok-cli-weekend',
    task: 'Modify file1, file2, file3 and verify them',
    allowedPaths,
    verification: ['npm run test'],
    riskLevel: 'low',
    output: 'text',
    maxFilesChanged: 5,
    maxToolRounds: 5,
    memoryPolicy: 'none',
    fleetPolicy: 'none',
    edits: [],
  };

  it('shouldDecompose returns true if allowedPaths.length > 2', () => {
    expect(shouldDecompose(contract)).toBe(true);
    expect(shouldDecompose({ ...contract, allowedPaths: ['file1.ts'] })).toBe(false);
  });

  it('shouldDecompose returns true if task description contains sequential keywords', () => {
    const stepContract = {
      ...contract,
      allowedPaths: ['file1.ts'],
      task: 'Step 1: do this. Step 2: do that.'
    };
    expect(shouldDecompose(stepContract)).toBe(true);
  });

  it('decomposeTask splits task into multiple sub-contracts', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Decompose task',
                subtasks: [
                  {
                    title: 'Task 1',
                    task: 'Modify file1',
                    allowedPaths: ['src/file1.ts'],
                    verification: ['npm test file1']
                  },
                  {
                    title: 'Task 2',
                    task: 'Modify file2 and file3',
                    allowedPaths: ['src/file2.ts', 'src/file3.ts'],
                    verification: ['npm test file2 file3']
                  }
                ]
              })
            }
          }
        ]
      })
    } as unknown as CodeBuddyClient;

    const result = await decomposeTask(contract, mockClient);
    expect(result.length).toBe(2);
    expect(result[0].task).toBe('Task 1: Modify file1');
    expect(result[0].allowedPaths).toEqual(['src/file1.ts']);
    expect(result[0].verification).toEqual(['npm test file1']);

    expect(result[1].task).toBe('Task 2: Modify file2 and file3');
    expect(result[1].allowedPaths).toEqual(['src/file2.ts', 'src/file3.ts']);
    expect(result[1].verification).toEqual(['npm test file2 file3']);
  });
});
