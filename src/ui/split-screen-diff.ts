/**
 * Split-Screen Diff View
 *
 * Side-by-side diff visualization:
 * - Before/after comparison
 * - Line highlighting
 * - Scrollable view
 * - Terminal-friendly output
 */

export interface DiffOptions {
  /** Terminal width */
  terminalWidth?: number;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Context lines around changes */
  contextLines?: number;
  /** Wrap long lines */
  wrapLines?: boolean;
  /** Color output */
  colorize?: boolean;
}

export interface SplitDiffLine {
  leftLineNo?: number;
  leftContent?: string;
  leftType: 'same' | 'removed' | 'empty';
  rightLineNo?: number;
  rightContent?: string;
  rightType: 'same' | 'added' | 'empty';
}

export interface SplitDiffResult {
  lines: SplitDiffLine[];
  stats: {
    linesAdded: number;
    linesRemoved: number;
    linesUnchanged: number;
  };
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  terminalWidth: 120,
  showLineNumbers: true,
  contextLines: 3,
  wrapLines: false,
  colorize: true,
};

// ANSI colors
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

/**
 * Generate split-screen diff
 */
export function generateSplitDiff(
  original: string,
  modified: string,
  options: DiffOptions = {}
): SplitDiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  // Compute LCS-based diff
  const diff = computeDiff(originalLines, modifiedLines);

  const stats = {
    linesAdded: 0,
    linesRemoved: 0,
    linesUnchanged: 0,
  };

  const lines: SplitDiffLine[] = [];

  for (const item of diff) {
    if (item.type === 'same') {
      stats.linesUnchanged++;
      lines.push({
        leftLineNo: item.leftLine,
        leftContent: item.content,
        leftType: 'same',
        rightLineNo: item.rightLine,
        rightContent: item.content,
        rightType: 'same',
      });
    } else if (item.type === 'removed') {
      stats.linesRemoved++;
      lines.push({
        leftLineNo: item.leftLine,
        leftContent: item.content,
        leftType: 'removed',
        rightType: 'empty',
      });
    } else if (item.type === 'added') {
      stats.linesAdded++;
      lines.push({
        leftType: 'empty',
        rightLineNo: item.rightLine,
        rightContent: item.content,
        rightType: 'added',
      });
    }
  }

  // Merge adjacent additions and removals into same line when possible
  const mergedLines = mergeAdjacentChanges(lines);

  // Apply context filtering if needed
  const contextLines = opts.contextLines > 0
    ? filterWithContext(mergedLines, opts.contextLines)
    : mergedLines;

  return { lines: contextLines, stats };
}

interface DiffItem {
  type: 'same' | 'added' | 'removed';
  content: string;
  leftLine?: number;
  rightLine?: number;
}

/**
 * Compute diff using simple algorithm
 */
function computeDiff(originalLines: string[], modifiedLines: string[]): DiffItem[] {
  const result: DiffItem[] = [];
  let leftIdx = 0;
  let rightIdx = 0;

  // Simple line-by-line comparison
  while (leftIdx < originalLines.length || rightIdx < modifiedLines.length) {
    const leftLine = leftIdx < originalLines.length ? originalLines[leftIdx] : undefined;
    const rightLine = rightIdx < modifiedLines.length ? modifiedLines[rightIdx] : undefined;

    if (leftLine === rightLine) {
      result.push({
        type: 'same',
        content: leftLine || '',
        leftLine: leftIdx + 1,
        rightLine: rightIdx + 1,
      });
      leftIdx++;
      rightIdx++;
    } else if (leftLine !== undefined && !modifiedLines.slice(rightIdx).includes(leftLine)) {
      // Line removed
      result.push({
        type: 'removed',
        content: leftLine,
        leftLine: leftIdx + 1,
      });
      leftIdx++;
    } else if (rightLine !== undefined && !originalLines.slice(leftIdx).includes(rightLine)) {
      // Line added
      result.push({
        type: 'added',
        content: rightLine,
        rightLine: rightIdx + 1,
      });
      rightIdx++;
    } else {
      // Modified - show as removal then addition
      if (leftLine !== undefined) {
        result.push({
          type: 'removed',
          content: leftLine,
          leftLine: leftIdx + 1,
        });
        leftIdx++;
      }
      if (rightLine !== undefined) {
        result.push({
          type: 'added',
          content: rightLine,
          rightLine: rightIdx + 1,
        });
        rightIdx++;
      }
    }
  }

  return result;
}

/**
 * Merge adjacent additions and removals into the same row
 */
function mergeAdjacentChanges(lines: SplitDiffLine[]): SplitDiffLine[] {
  const result: SplitDiffLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    if (current === undefined) {
      i++;
      continue;
    }

    // If this is a removal followed by an addition, merge them
    if (current.leftType === 'removed' && current.rightType === 'empty') {
      // Look ahead for an addition to pair with
      const next = lines[i + 1];
      if (next !== undefined) {
        if (next.leftType === 'empty' && next.rightType === 'added') {
          // Merge them
          result.push({
            leftLineNo: current.leftLineNo,
            leftContent: current.leftContent,
            leftType: 'removed',
            rightLineNo: next.rightLineNo,
            rightContent: next.rightContent,
            rightType: 'added',
          });
          i += 2;
          continue;
        }
      }
    }

    result.push(current);
    i++;
  }

  return result;
}

/**
 * Filter lines with context
 */
function filterWithContext(lines: SplitDiffLine[], contextLines: number): SplitDiffLine[] {
  // Find changed line indices
  const changedIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.leftType !== 'same' || line.rightType !== 'same') {
      // Include context around this change
      for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
        changedIndices.add(j);
      }
    }
  }

  // Build filtered result with separators
  const result: SplitDiffLine[] = [];
  let lastIncluded = -1;

  for (let i = 0; i < lines.length; i++) {
    if (changedIndices.has(i)) {
      const line = lines[i];
      if (line === undefined) continue;
      // Add separator if there's a gap
      if (lastIncluded >= 0 && i > lastIncluded + 1) {
        result.push({
          leftType: 'same',
          leftContent: '...',
          rightType: 'same',
          rightContent: '...',
        });
      }
      result.push(line);
      lastIncluded = i;
    }
  }

  return result;
}

/**
 * Format split diff for terminal display
 */
export function formatSplitDiff(
  result: SplitDiffResult,
  options: DiffOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Calculate column widths
  const lineNoWidth = opts.showLineNumbers ? 4 : 0;
  const separator = ' │ ';
  const separatorWidth = separator.length;
  const availableWidth = opts.terminalWidth - separatorWidth - (lineNoWidth * 2);
  const columnWidth = Math.floor(availableWidth / 2);

  const output: string[] = [];

  // Header
  output.push(createHeader(columnWidth, lineNoWidth, separator, opts.colorize));

  // Stats line
  output.push(createStatsLine(result.stats, opts.terminalWidth, opts.colorize));

  // Separator
  output.push('─'.repeat(opts.terminalWidth));

  // Lines
  for (const line of result.lines) {
    output.push(formatLine(line, columnWidth, lineNoWidth, separator, opts));
  }

  // Footer
  output.push('─'.repeat(opts.terminalWidth));

  return output.join('\n');
}

/**
 * Create header line
 */
function createHeader(
  columnWidth: number,
  lineNoWidth: number,
  separator: string,
  colorize: boolean
): string {
  const leftHeader = 'ORIGINAL'.padStart(Math.floor(columnWidth / 2) + 4).padEnd(columnWidth);
  const rightHeader = 'MODIFIED'.padStart(Math.floor(columnWidth / 2) + 4).padEnd(columnWidth);

  const prefix = colorize ? COLORS.bold : '';
  const suffix = colorize ? COLORS.reset : '';

  return `${prefix}${''.padEnd(lineNoWidth)}${leftHeader}${separator}${''.padEnd(lineNoWidth)}${rightHeader}${suffix}`;
}

/**
 * Create stats line
 */
function createStatsLine(
  stats: SplitDiffResult['stats'],
  width: number,
  colorize: boolean
): string {
  const added = colorize ? `${COLORS.green}+${stats.linesAdded}${COLORS.reset}` : `+${stats.linesAdded}`;
  const removed = colorize ? `${COLORS.red}-${stats.linesRemoved}${COLORS.reset}` : `-${stats.linesRemoved}`;
  const unchanged = colorize ? `${COLORS.dim}~${stats.linesUnchanged}${COLORS.reset}` : `~${stats.linesUnchanged}`;

  const text = `${added} added, ${removed} removed, ${unchanged} unchanged`;
  return text;
}

/**
 * Format a single split line
 */
function formatLine(
  line: SplitDiffLine,
  columnWidth: number,
  lineNoWidth: number,
  separator: string,
  opts: Required<DiffOptions>
): string {
  // Format line numbers
  const leftLineNo = line.leftLineNo !== undefined
    ? line.leftLineNo.toString().padStart(lineNoWidth - 1) + ' '
    : ' '.repeat(lineNoWidth);
  const rightLineNo = line.rightLineNo !== undefined
    ? line.rightLineNo.toString().padStart(lineNoWidth - 1) + ' '
    : ' '.repeat(lineNoWidth);

  // Format content
  let leftContent = line.leftContent || '';
  let rightContent = line.rightContent || '';

  // Truncate or wrap
  if (!opts.wrapLines) {
    if (leftContent.length > columnWidth) {
      leftContent = leftContent.slice(0, columnWidth - 3) + '...';
    }
    if (rightContent.length > columnWidth) {
      rightContent = rightContent.slice(0, columnWidth - 3) + '...';
    }
  }

  leftContent = leftContent.padEnd(columnWidth);
  rightContent = rightContent.padEnd(columnWidth);

  // Apply colors
  if (opts.colorize) {
    if (line.leftType === 'removed') {
      leftContent = `${COLORS.bgRed}${leftContent}${COLORS.reset}`;
    }
    if (line.rightType === 'added') {
      rightContent = `${COLORS.bgGreen}${rightContent}${COLORS.reset}`;
    }
    if (line.leftType === 'empty') {
      leftContent = `${COLORS.dim}${leftContent}${COLORS.reset}`;
    }
    if (line.rightType === 'empty') {
      rightContent = `${COLORS.dim}${rightContent}${COLORS.reset}`;
    }
  }

  // Build line
  let leftPart = leftLineNo + leftContent;
  let rightPart = rightLineNo + rightContent;

  // Add line number colors
  if (opts.colorize) {
    if (line.leftType === 'removed') {
      leftPart = `${COLORS.red}${leftLineNo}${COLORS.reset}${leftContent}`;
    }
    if (line.rightType === 'added') {
      rightPart = `${COLORS.green}${rightLineNo}${COLORS.reset}${rightContent}`;
    }
  }

  return `${leftPart}${separator}${rightPart}`;
}

/**
 * Create unified diff from split diff
 */
export function toUnifiedDiff(result: SplitDiffResult): string {
  const output: string[] = [];

  for (const line of result.lines) {
    if (line.leftType === 'same' && line.rightType === 'same') {
      output.push(` ${line.leftContent || ''}`);
    } else {
      if (line.leftType === 'removed' && line.leftContent !== undefined) {
        output.push(`-${line.leftContent}`);
      }
      if (line.rightType === 'added' && line.rightContent !== undefined) {
        output.push(`+${line.rightContent}`);
      }
    }
  }

  return output.join('\n');
}

/**
 * Format a compact summary of changes
 */
export function formatCompactSummary(result: SplitDiffResult): string {
  const { stats } = result;

  const added = stats.linesAdded > 0 ? `+${stats.linesAdded}` : '';
  const removed = stats.linesRemoved > 0 ? `-${stats.linesRemoved}` : '';

  if (!added && !removed) {
    return 'No changes';
  }

  return [added, removed].filter(Boolean).join(' ');
}

/**
 * Check if there are any changes
 */
export function hasChanges(result: SplitDiffResult): boolean {
  return result.stats.linesAdded > 0 || result.stats.linesRemoved > 0;
}

export default generateSplitDiff;
