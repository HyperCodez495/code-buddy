/**
 * apply_patch Tool — Codex-style patch format
 *
 * Parses and applies patches in the *** Begin Patch / *** End Patch format.
 * Simpler than unified diff for LLM-generated edits.
 *
 * Format:
 *   *** Begin Patch
 *   *** Add File: path
 *   +line1
 *   +line2
 *   *** Delete File: path
 *   *** Update File: path
 *   @@ optional context header
 *    context line (space prefix)
 *   -removed line
 *   +added line
 *   *** End Patch
 *
 * Uses 4-pass seek_sequence for fuzzy matching:
 *   1. Exact byte match
 *   2. Trailing whitespace tolerance
 *   3. Full trim (leading + trailing)
 *   4. Unicode normalization (typographic → ASCII)
 *
 * Inspired by OpenAI Codex CLI's apply-patch crate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface FileOp {
  type: 'add' | 'delete' | 'update';
  path: string;
  moveTo?: string;
  hunks?: Hunk[];
  content?: string;
}

interface Hunk {
  header?: string;
  oldLines: string[];
  newLines: string[];
}

interface PatchResult {
  filesAdded: string[];
  filesDeleted: string[];
  filesUpdated: string[];
  errors: string[];
}

// ============================================================================
// Unicode Normalization (Pass 4)
// ============================================================================

function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2002\u2003\u2009]/g, ' ');
}

// ============================================================================
// 4-Pass seek_sequence Algorithm
// ============================================================================

/**
 * Find a sequence of lines in the source, starting from startIndex.
 * Tries 4 matching strategies with decreasing strictness.
 *
 * @returns The index where the pattern starts, or -1 if not found.
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number = 0,
): number {
  if (pattern.length === 0) return startIndex;
  if (startIndex + pattern.length > lines.length) return -1;

  // Pass 1: Exact match
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal !== patVal) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 2: Trailing whitespace tolerance
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal.trimEnd() !== patVal.trimEnd()) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 3: Full trim (leading + trailing)
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal.trim() !== patVal.trim()) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 4: Unicode normalization
  const normalizedPattern = pattern.map(l => normalizeUnicode(l).trim());
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const normPat = normalizedPattern[j];
      if (lineVal === undefined || normPat === undefined || normalizeUnicode(lineVal).trim() !== normPat) { match = false; break; }
    }
    if (match) return i;
  }

  return -1;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a patch string into FileOp operations.
 */
export function parsePatch(patchText: string): FileOp[] {
  const ops: FileOp[] = [];

  let text = patchText.trim();
  // Strip heredoc wrappers (GPT sometimes wraps in <<'EOF'...EOF)
  text = text.replace(/^<<['"]?EOF['"]?\s*\n/i, '').replace(/\nEOF\s*$/i, '');

  const beginIdx = text.indexOf('*** Begin Patch');
  const endIdx = text.indexOf('*** End Patch');
  if (beginIdx < 0) return ops;

  const body = text.substring(
    text.indexOf('\n', beginIdx) + 1,
    endIdx >= 0 ? endIdx : undefined,
  );

  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) { i++; continue; }

    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      const contentLines: string[] = [];
      i++;
      let addLine = lines[i];
      while (i < lines.length && addLine !== undefined && !addLine.startsWith('***') && !addLine.startsWith('@@')) {
        if (addLine.startsWith('+')) {
          contentLines.push(addLine.slice(1));
        }
        i++;
        addLine = lines[i];
      }
      ops.push({ type: 'add', path: filePath, content: contentLines.join('\n') });

    } else if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim();
      ops.push({ type: 'delete', path: filePath });
      i++;

    } else if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      let moveTo: string | undefined;
      i++;

      const moveLine = lines[i];
      if (i < lines.length && moveLine !== undefined && moveLine.startsWith('*** Move to: ')) {
        moveTo = moveLine.slice('*** Move to: '.length).trim();
        i++;
      }

      const hunks: Hunk[] = [];
      let hunkLine = lines[i];
      while (i < lines.length && hunkLine !== undefined && !hunkLine.startsWith('*** ')) {
        if (hunkLine.startsWith('@@')) {
          const header = hunkLine.slice(2).trim() || undefined;
          i++;
          const oldLines: string[] = [];
          const newLines: string[] = [];

          let l = lines[i];
          while (i < lines.length && l !== undefined && !l.startsWith('@@') && !l.startsWith('*** ')) {
            if (l.startsWith(' ')) {
              oldLines.push(l.slice(1));
              newLines.push(l.slice(1));
            } else if (l.startsWith('-')) {
              oldLines.push(l.slice(1));
            } else if (l.startsWith('+')) {
              newLines.push(l.slice(1));
            }
            i++;
            l = lines[i];
          }
          hunks.push({ header, oldLines, newLines });
        } else {
          i++;
        }
        hunkLine = lines[i];
      }
      ops.push({ type: 'update', path: filePath, moveTo, hunks });

    } else {
      i++;
    }
  }

  return ops;
}

// ============================================================================
// Applier
// ============================================================================

export function applyPatchOps(ops: FileOp[], cwd: string = process.cwd()): PatchResult {
  const result: PatchResult = { filesAdded: [], filesDeleted: [], filesUpdated: [], errors: [] };

  for (const op of ops) {
    const fullPath = path.resolve(cwd, op.path);
    try {
      if (op.type === 'add') {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, op.content ?? '');
        result.filesAdded.push(op.path);

      } else if (op.type === 'delete') {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          result.filesDeleted.push(op.path);
        }

      } else if (op.type === 'update') {
        if (!fs.existsSync(fullPath)) {
          result.errors.push(`File not found: ${op.path}`);
          continue;
        }
        const fileLines = fs.readFileSync(fullPath, 'utf-8').split('\n');
        let lineIndex = 0;

        for (const hunk of op.hunks ?? []) {
          if (hunk.oldLines.length > 0) {
            const seekIdx = seekSequence(fileLines, hunk.oldLines, lineIndex);
            if (seekIdx >= 0) {
              fileLines.splice(seekIdx, hunk.oldLines.length, ...hunk.newLines);
              lineIndex = seekIdx + hunk.newLines.length;
            } else {
              result.errors.push(`Hunk failed in ${op.path}: "${hunk.oldLines[0]?.substring(0, 60)}..."`);
            }
          } else if (hunk.newLines.length > 0) {
            fileLines.splice(lineIndex, 0, ...hunk.newLines);
            lineIndex += hunk.newLines.length;
          }
        }

        if (op.moveTo) {
          const newPath = path.resolve(cwd, op.moveTo);
          const newDir = path.dirname(newPath);
          if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
          fs.writeFileSync(newPath, fileLines.join('\n'));
          fs.unlinkSync(fullPath);
          result.filesUpdated.push(`${op.path} → ${op.moveTo}`);
        } else {
          fs.writeFileSync(fullPath, fileLines.join('\n'));
          result.filesUpdated.push(op.path);
        }
      }
    } catch (err) {
      result.errors.push(`${op.type} ${op.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

// ============================================================================
// Tool
// ============================================================================

export class ApplyPatchTool extends BaseTool {
  readonly name = 'apply_patch';
  readonly description = 'Apply a patch to modify files. Use *** Begin Patch / *** End Patch format with -/+ lines. Supports adding, deleting, and updating files with fuzzy matching.';

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      patch: {
        type: 'string',
        description: 'The patch content in *** Begin Patch format.',
        required: true,
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const patchText = input.patch as string;
    if (!patchText) return this.error('patch is required');

    try {
      const ops = parsePatch(patchText);
      if (ops.length === 0) {
        return this.error('No valid operations found in patch.');
      }
      const patchResult = applyPatchOps(ops);
      const lines: string[] = [];
      if (patchResult.filesAdded.length > 0) lines.push(`Added: ${patchResult.filesAdded.join(', ')}`);
      if (patchResult.filesDeleted.length > 0) lines.push(`Deleted: ${patchResult.filesDeleted.join(', ')}`);
      if (patchResult.filesUpdated.length > 0) lines.push(`Updated: ${patchResult.filesUpdated.join(', ')}`);
      if (patchResult.errors.length > 0) lines.push(`Errors: ${patchResult.errors.join('; ')}`);
      logger.debug(`apply_patch: +${patchResult.filesAdded.length} -${patchResult.filesDeleted.length} ~${patchResult.filesUpdated.length} !${patchResult.errors.length}`);
      const onlyLine = lines[0];
      return patchResult.errors.length > 0 && lines.length === 1 && onlyLine !== undefined
        ? this.error(onlyLine)
        : this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`Patch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
