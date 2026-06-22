/**
 * Graph Tool Adapters — CodeExplorer Knowledge Graph
 *
 * ITool-compliant adapters for the FormalToolRegistry:
 * - AnalyzeImpactTool: blast radius analysis
 * - DetectProcessesTool: execution flow detection
 * - FindCommunitiesTool: architectural module detection
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getKnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { analyzeImpact, type ImpactResult } from '../../knowledge/impact-analyzer.js';
import { detectProcesses, type ExecutionProcess } from '../../knowledge/process-detector.js';
import { detectCommunities, type Community } from '../../knowledge/community-detector.js';

// ============================================================================
// analyze_impact
// ============================================================================

export class AnalyzeImpactTool implements ITool {
  readonly name = 'analyze_impact';
  readonly description =
    'Analyze the blast radius of changing a symbol. Shows affected symbols with risk levels, affected files, affected processes, and overall risk.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      return {
        success: false,
        error: 'Code graph is empty. Run codebase analysis first (e.g., /docs-generate or codebase_map tool).',
      };
    }

    const target = input.target as string;
    const direction = (input.direction as 'up' | 'down' | 'both') ?? 'both';
    const maxDepth = (input.maxDepth as number) ?? 5;

    const report: ImpactResult = analyzeImpact(graph, target, maxDepth);

    if (report.totalAffected === 0) {
      return { success: true, output: `No impact found for '${target}'.` };
    }

    // Use the pre-formatted output from analyzeImpact
    return { success: true, output: report.formatted || [
      `Impact analysis for '${report.entity}':`,
      `  Direct callers: ${report.directCallers.length}`,
      `  Indirect callers: ${report.indirectCallers.length}`,
      `  Affected files: ${report.affectedFiles.length}`,
      `  Total affected: ${report.totalAffected}`,
      '',
      ...report.directCallers.slice(0, 20).map(c => `  [d=1] ${c}`),
      ...report.indirectCallers.slice(0, 20).map(c => `  [d=2+] ${c}`),
    ].join('\n') };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Symbol name or partial name to analyze',
          },
          direction: {
            type: 'string',
            description: 'Analysis direction: up (callers), down (callees), both (full)',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum traversal depth (default: 5)',
          },
        },
        required: ['target'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.target !== 'string' || !data.target.trim()) {
      return { valid: false, errors: ['target must be a non-empty string'] };
    }
    if (data.direction !== undefined && !['up', 'down', 'both'].includes(data.direction as string)) {
      return { valid: false, errors: ['direction must be one of: up, down, both'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['impact', 'blast radius', 'affected', 'change', 'risk', 'callers', 'callees', 'dependencies'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// detect_processes
// ============================================================================

export class DetectProcessesTool implements ITool {
  readonly name = 'detect_processes';
  readonly description =
    'Detect execution flows in the codebase by BFS from entry points. Returns named processes with step sequences.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      return {
        success: false,
        error: 'Code graph is empty. Run codebase analysis first (e.g., /docs-generate or codebase_map tool).',
      };
    }

    const entryPoint = input.entryPoint as string | undefined;
    const minSteps = (input.minSteps as number) ?? 3;

    const processes: ExecutionProcess[] = detectProcesses(graph, {
      entryPoint,
      minSteps,
    });

    if (processes.length === 0) {
      return {
        success: true,
        output: entryPoint
          ? `No processes found from entry point "${entryPoint}" with at least ${minSteps} steps.`
          : `No processes detected with at least ${minSteps} steps.`,
      };
    }

    const lines: string[] = [
      `Detected ${processes.length} execution process${processes.length > 1 ? 'es' : ''}:`,
      '',
    ];

    for (const proc of processes) {
      lines.push(`## ${proc.name}`);
      lines.push(`Entry: ${proc.entryPoint}`);
      lines.push(`Steps: ${proc.steps.length} | Files: ${proc.files.length}`);
      lines.push('Flow:');
      for (const step of proc.steps.slice(0, 15)) {
        lines.push(`  ${step.stepIndex + 1}. [${step.type}] ${step.symbolName} (${step.filePath})`);
      }
      if (proc.steps.length > 15) {
        lines.push(`  +${proc.steps.length - 15} more steps`);
      }
      lines.push('');
    }

    return { success: true, output: lines.join('\n') };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          entryPoint: {
            type: 'string',
            description: 'Specific entry point to trace from (optional)',
          },
          minSteps: {
            type: 'number',
            description: 'Minimum steps to qualify as a process (default: 3)',
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['process', 'flow', 'execution', 'entry point', 'trace', 'call chain', 'pipeline'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// find_communities
// ============================================================================

export class FindCommunitiesTool implements ITool {
  readonly name = 'find_communities';
  readonly description =
    'Detect architectural modules (communities) in the codebase using label propagation clustering.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      return {
        success: false,
        error: 'Code graph is empty. Run codebase analysis first (e.g., /docs-generate or codebase_map tool).',
      };
    }

    const minSize = (input.minSize as number) ?? 3;

    const communities: Community[] = detectCommunities(graph, { minSize });

    if (communities.length === 0) {
      return {
        success: true,
        output: `No communities detected with at least ${minSize} symbols.`,
      };
    }

    const lines: string[] = [
      `Detected ${communities.length} architectural communit${communities.length > 1 ? 'ies' : 'y'}:`,
      '',
    ];

    for (const comm of communities) {
      lines.push(`## ${comm.name} (id: ${comm.id})`);
      lines.push(`Symbols: ${comm.symbols.length} | Files: ${comm.files.length} | Cohesion: ${(comm.cohesion * 100).toFixed(1)}%`);

      if (comm.entryPoints.length > 0) {
        const shown = comm.entryPoints.slice(0, 5);
        lines.push(`Entry points: ${shown.join(', ')}${comm.entryPoints.length > 5 ? ` +${comm.entryPoints.length - 5} more` : ''}`);
      }

      if (comm.files.length > 0) {
        const shown = comm.files.slice(0, 8);
        lines.push(`Files: ${shown.join(', ')}${comm.files.length > 8 ? ` +${comm.files.length - 8} more` : ''}`);
      }

      lines.push('');
    }

    return { success: true, output: lines.join('\n') };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          minSize: {
            type: 'number',
            description: 'Minimum symbols per community (default: 3)',
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['community', 'cluster', 'module', 'architecture', 'cohesion', 'coupling', 'label propagation'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create graph tool instances for the FormalToolRegistry.
 */
export function createGraphTools(): ITool[] {
  return [
    new AnalyzeImpactTool(),
    new DetectProcessesTool(),
    new FindCommunitiesTool(),
  ];
}

/**
 * Reset graph tool instances (for testing).
 */
export function resetGraphInstances(): void {
  // Stateless tools — nothing to reset
}
