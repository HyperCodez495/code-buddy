/**
 * TreeRenderer - Render file/directory trees
 *
 * Displays tree structures with:
 * - ├─ └─ box-drawing characters
 * - File/directory icons (optional emoji)
 * - File sizes (human-readable)
 * - Summary statistics
 */

import {
  Renderer,
  RenderContext,
  TreeData,
  TreeNode,
  isTreeData,
} from './types.js';

// ============================================================================
// Renderer Implementation
// ============================================================================

export const treeRenderer: Renderer<TreeData> = {
  id: 'tree',
  name: 'Tree Renderer',
  priority: 10,

  canRender(data: unknown): data is TreeData {
    return isTreeData(data);
  },

  render(data: TreeData, ctx: RenderContext): string {
    if (ctx.mode === 'plain') {
      return renderPlain(data);
    }
    return renderFancy(data, ctx);
  },
};

// ============================================================================
// Plain Mode Rendering
// ============================================================================

function renderPlain(data: TreeData): string {
  const lines: string[] = [];
  const { root, nodes, stats } = data;

  lines.push(`Tree: ${root}`);
  if (stats) {
    lines.push(`Files: ${stats.files}, Directories: ${stats.directories}`);
    if (stats.totalSize !== undefined) {
      lines.push(`Total Size: ${formatSize(stats.totalSize)}`);
    }
  }
  lines.push('');

  // Render tree
  for (const [i, node] of nodes.entries()) {
    const isLast = i === nodes.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    renderNodePlain(node, lines, prefix, isLast);
  }

  return lines.join('\n');
}

function renderNodePlain(
  node: TreeNode,
  lines: string[],
  prefix: string,
  isLast: boolean,
  depth = 0
): void {
  const indent = '    '.repeat(depth);
  const icon = node.isDirectory ? '[DIR]' : '';
  const size = node.size !== undefined ? ` (${formatSize(node.size)})` : '';
  lines.push(`${indent}${prefix}${icon}${node.name}${size}`);

  if (node.children && node.children.length > 0) {
    const _childIndent = isLast ? '    ' : '│   ';
    for (const [i, child] of node.children.entries()) {
      const childIsLast = i === node.children.length - 1;
      const childPrefix = childIsLast ? '└── ' : '├── ';
      renderNodePlain(child, lines, childPrefix, childIsLast, depth + 1);
    }
  }
}

// ============================================================================
// Fancy Mode Rendering
// ============================================================================

function renderFancy(data: TreeData, ctx: RenderContext): string {
  const lines: string[] = [];
  const { root, nodes, stats } = data;
  const W = Math.min(ctx.width, 100);

  // Colors
  const colors = {
    dir: ctx.color ? '\x1b[34m\x1b[1m' : '', // Blue bold
    file: ctx.color ? '\x1b[0m' : '',        // Default
    size: ctx.color ? '\x1b[90m' : '',       // Gray
    tree: ctx.color ? '\x1b[90m' : '',       // Gray for tree chars
    reset: ctx.color ? '\x1b[0m' : '',
  };

  // Icons
  const icons = {
    dir: ctx.emoji ? '📁 ' : '',
    file: ctx.emoji ? '📄 ' : '',
    tree: ctx.emoji ? '🌳 ' : '',
  };

  // Header box
  lines.push('┌' + '─'.repeat(W - 2) + '┐');
  const title = `${icons.tree}TREE: ${root}`;
  lines.push('│ ' + title + ' '.repeat(Math.max(0, W - title.length - 4)) + ' │');

  // Stats
  if (stats) {
    const statsLine = `${stats.files} files, ${stats.directories} directories`;
    const fullStats = stats.totalSize !== undefined
      ? `${statsLine}, ${formatSize(stats.totalSize)}`
      : statsLine;
    lines.push('│ ' + colors.size + fullStats + colors.reset + ' '.repeat(Math.max(0, W - fullStats.length - 4)) + ' │');
  }

  lines.push('├' + '─'.repeat(W - 2) + '┤');

  // Render tree
  for (const [i, node] of nodes.entries()) {
    const isLast = i === nodes.length - 1;
    renderNodeFancy(node, lines, '', isLast, colors, icons, W);
  }

  lines.push('└' + '─'.repeat(W - 2) + '┘');

  return lines.join('\n');
}

function renderNodeFancy(
  node: TreeNode,
  lines: string[],
  prefix: string,
  isLast: boolean,
  colors: Record<string, string>,
  icons: Record<string, string>,
  width: number
): void {
  // Tree characters
  const branch = isLast ? '└── ' : '├── ';
  const icon = (node.isDirectory ? icons.dir : icons.file) ?? '';
  const color = (node.isDirectory ? colors.dir : colors.file) ?? '';

  // Format name with size
  let displayName = node.name;
  let sizeStr = '';
  if (node.size !== undefined && !node.isDirectory) {
    sizeStr = ` ${colors.size}(${formatSize(node.size)})${colors.reset}`;
    const sizePlain = ` (${formatSize(node.size)})`;
    // Truncate name if too long
    const maxNameLen = width - prefix.length - branch.length - icon.length - sizePlain.length - 6;
    if (displayName.length > maxNameLen) {
      displayName = displayName.substring(0, maxNameLen - 3) + '...';
    }
  }

  const line = `│ ${prefix}${colors.tree}${branch}${colors.reset}${color}${icon}${displayName}${colors.reset}${sizeStr}`;
  const linePlain = `${prefix}${branch}${icon}${displayName} (${formatSize(node.size || 0)})`;
  const padding = ' '.repeat(Math.max(0, width - linePlain.length - 2));
  lines.push(line + padding + ' │');

  // Render children
  if (node.children && node.children.length > 0) {
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    for (const [i, child] of node.children.entries()) {
      const childIsLast = i === node.children.length - 1;
      renderNodeFancy(child, lines, childPrefix, childIsLast, colors, icons, width);
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) return `${bytes} B`;

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
