import type { ToolResult } from '../../types/index.js';
import { CsvAnalyzeTool } from '../csv-analyze-tool.js';
import type { ITool, IToolMetadata, IValidationResult, ToolCategoryType, ToolSchema } from './types.js';

let csvInstance: CsvAnalyzeTool | null = null;

function getCsvTool(): CsvAnalyzeTool {
  if (!csvInstance) csvInstance = new CsvAnalyzeTool();
  return csvInstance;
}

export class CsvAnalyzeExecuteTool implements ITool {
  readonly name = 'csv_analyze';
  readonly description =
    'Read-only deterministic CSV analysis: dimensions, inferred column types, numeric stats, and a row preview.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getCsvTool().execute({
      path: input.path as string,
      delimiter: input.delimiter as string | undefined,
      maxPreview: input.maxPreview as number | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the CSV file to analyze.' },
          delimiter: { type: 'string', description: "Field delimiter (default ',')." },
          maxPreview: { type: 'number', description: 'Number of preview rows (default a small value).' },
        },
        required: ['path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.path !== 'string' || data.path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['csv', 'table', 'tabular', 'columns', 'numeric', 'stats', 'preview', 'data', 'analyze', 'analyse'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createCsvTools(): ITool[] {
  return [new CsvAnalyzeExecuteTool()];
}
