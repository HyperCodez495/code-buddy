import { describe, it, expect } from 'vitest';
import { compileVisualToCore } from '../../cowork/src/main/workflows/dag-compiler.js';
import type { WorkflowVisualDefinition } from '../../cowork/src/shared/workflow-types.js';

describe('Workflow Visual Loops & Batching Compilation', () => {
  it('should compile visual loop node and translate task variables', () => {
    const visual: WorkflowVisualDefinition = {
      name: 'Loop test',
      description: 'Loop compilation test',
      nodes: [
        { id: 'n_start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
        {
          id: 'n_loop',
          type: 'loop',
          name: 'Loop node',
          position: { x: 100, y: 0 },
          config: {
            condition: '$iteration < 3',
            maxIterations: 5,
          },
        },
        {
          id: 'n_tool',
          type: 'tool',
          name: 'Tool node',
          position: { x: 200, y: -50 },
          config: {
            toolName: 'view_file',
            toolInput: { path: '$task_n_start.output' },
          },
        },
        { id: 'n_end', type: 'end', name: 'End', position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_loop' },
        { id: 'e2', source: 'n_loop', target: 'n_tool', label: 'body' },
        { id: 'e3', source: 'n_loop', target: 'n_end', label: 'exit' },
      ],
    };

    const compiled = compileVisualToCore(visual);

    expect(compiled.steps.length).toBe(1);
    const loopStep = compiled.steps[0];
    expect(loopStep.type).toBe('loop');
    expect(loopStep.loopCondition).toBe('$iteration < 3');

    // Check loop body compilation
    expect(loopStep.loopBody?.length).toBe(1);
    const toolTask = loopStep.loopBody![0].tasks![0];
    expect(toolTask.type).toBe('tool_invoke');

    // Check variable translation: $task_n_start.output should be translated to $task_task_n_start
    expect((toolTask.input.toolInput as any).path).toBe('$task_task_n_start');
  });

  it('should compile visual batch node', () => {
    const visual: WorkflowVisualDefinition = {
      name: 'Batch test',
      description: 'Batch compilation test',
      nodes: [
        { id: 'n_start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
        {
          id: 'n_batch',
          type: 'batch',
          name: 'Batch node',
          position: { x: 100, y: 0 },
          config: {
            itemsExpression: '$task_n_start.output',
            variableName: 'item',
            concurrencyLimit: 2,
          },
        },
        {
          id: 'n_tool',
          type: 'tool',
          name: 'Tool node',
          position: { x: 200, y: -50 },
          config: {
            toolName: 'view_file',
            toolInput: { path: '$item' },
          },
        },
        { id: 'n_end', type: 'end', name: 'End', position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_batch' },
        { id: 'e2', source: 'n_batch', target: 'n_tool', label: 'body' },
        { id: 'e3', source: 'n_batch', target: 'n_end', label: 'exit' },
      ],
    };

    const compiled = compileVisualToCore(visual);

    expect(compiled.steps.length).toBe(1);
    const batchStep: any = compiled.steps[0];
    expect(batchStep.type).toBe('batch');
    expect(batchStep.batchItemsExpression).toBe('$task_task_n_start');
    expect(batchStep.batchVariableName).toBe('item');
    expect(batchStep.batchConcurrencyLimit).toBe(2);
    expect(batchStep.batchBody?.length).toBe(1);
  });
});
