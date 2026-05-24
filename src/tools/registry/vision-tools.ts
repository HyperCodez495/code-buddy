/**
 * Vision and Image Tool Adapters
 *
 * ITool-compliant adapters for OCR and Image Processing operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import { OcrTool } from '../vision/ocr-tool.js';
import { ImageProcessorTool } from '../vision/image-processor.js';
import { captureCameraSnapshot } from '../../companion/camera.js';

// ============================================================================
// OcrExtractTool
// ============================================================================

export class OcrExtractTool implements ITool {
  readonly name = 'ocr_extract';
  readonly description = 'Extract text from an image file using Tesseract OCR.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const imagePath = input.image_path as string;
    const language = input.language as string || 'eng';

    try {
      const ocr = OcrTool.getInstance();
      const text = await ocr.extractText(imagePath, language);
      return { success: true, output: text || '[No text found in image]' };
    } catch (error) {
      return { success: false, error: `OCR extraction failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Absolute or relative path to the image file',
          },
          language: {
            type: 'string',
            description: 'Language code for OCR (default: "eng")',
            default: 'eng',
          },
        },
        required: ['image_path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (typeof data?.image_path !== 'string' || data.image_path.trim() === '') {
      return { valid: false, errors: ['image_path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'vision' as ToolCategoryType,
      keywords: ['ocr', 'text', 'extract', 'image', 'read', 'vision'],
      priority: 6,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ImageAnalyzeTool
// ============================================================================

export class ImageAnalyzeTool implements ITool {
  readonly name = 'image_analyze';
  readonly description = 'Analyze an image to get dimensions, format, and metadata.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const imagePath = input.image_path as string;

    try {
      const processor = ImageProcessorTool.getInstance();
      const analysis = await processor.analyze(imagePath);
      return { success: true, output: JSON.stringify(analysis, null, 2) };
    } catch (error) {
      return { success: false, error: `Image analysis failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Path to the image file',
          },
        },
        required: ['image_path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (typeof data?.image_path !== 'string') {
      return { valid: false, errors: ['image_path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'vision' as ToolCategoryType,
      keywords: ['image', 'analyze', 'metadata', 'dimensions', 'format'],
      priority: 6,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// CameraSnapshotTool
// ============================================================================

export class CameraSnapshotTool implements ITool {
  readonly name = 'camera_snapshot';
  readonly description = 'Capture one local webcam frame to an image file for Buddy companion vision. Requires ffmpeg and OS camera permission.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const result = await captureCameraSnapshot({
      cwd: context?.cwd,
      outputPath: input.output_path as string | undefined,
      device: input.device as string | undefined,
      timeoutMs: input.timeout_ms as number | undefined,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Camera snapshot failed',
        output: result.command,
      };
    }

    return {
      success: true,
      output: JSON.stringify({
        path: result.path,
        command: result.command,
        percept_id: result.perceptId,
        percept_store: result.perceptPath,
        note: 'Use image analysis, OCR, or a multimodal model turn to inspect this frame.',
      }, null, 2),
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          output_path: {
            type: 'string',
            description: 'Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace.',
          },
          device: {
            type: 'string',
            description: 'Optional ffmpeg camera device. Windows example: video=Integrated Camera; macOS example: 0; Linux example: /dev/video0.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Capture timeout in milliseconds (default: 10000).',
            minimum: 1000,
            maximum: 60000,
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return { valid: true };
    if (data.output_path !== undefined && typeof data.output_path !== 'string') {
      return { valid: false, errors: ['output_path must be a string'] };
    }
    if (data.device !== undefined && typeof data.device !== 'string') {
      return { valid: false, errors: ['device must be a string'] };
    }
    if (data.timeout_ms !== undefined && typeof data.timeout_ms !== 'number') {
      return { valid: false, errors: ['timeout_ms must be a number'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['camera', 'webcam', 'snapshot', 'photo', 'vision', 'see', 'look', 'companion'],
      priority: 7,
      modifiesFiles: true,
      requiresConfirmation: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createVisionTools(): ITool[] {
  return [
    new OcrExtractTool(),
    new ImageAnalyzeTool(),
    new CameraSnapshotTool(),
  ];
}
