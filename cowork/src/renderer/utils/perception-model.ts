/**
 * Pure helpers for file-tree perception surfaces.
 *
 * @module renderer/utils/perception-model
 */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export function flattenTree(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  const visit = (node: FileNode) => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

function extOf(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return 'none';
  return fileName.slice(dot + 1).toLowerCase();
}

export function countByExt(nodes: FileNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of flattenTree(nodes)) {
    if (node.type !== 'file') continue;
    const ext = extOf(node.path);
    counts[ext] = (counts[ext] ?? 0) + 1;
  }
  return counts;
}
