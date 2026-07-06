export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git']);

// Preference order for the file a bolt.new-style workbench opens on load.
const DEFAULT_FILE_SUFFIXES = [
  'src/app.tsx',
  'src/app.jsx',
  'app/page.tsx',
  'src/main.tsx',
  'src/main.jsx',
  'src/index.tsx',
  'index.html',
  'src/index.ts',
  'readme.md',
  'package.json',
];

/** All file paths in the tree, depth-first. */
export function flattenFiles(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') out.push(node.path);
    else if (node.children) out.push(...flattenFiles(node.children));
  }
  return out;
}

/**
 * Pick the most relevant file to open when a project loads (App/main/index/
 * README/package.json), falling back to the first file. Null for an empty tree.
 */
export function pickDefaultFile(nodes: readonly TreeNode[]): string | null {
  const files = flattenFiles(nodes);
  if (files.length === 0) return null;
  for (const suffix of DEFAULT_FILE_SUFFIXES) {
    const match = files.find((p) => p.toLowerCase().endsWith(suffix));
    if (match) return match;
  }
  return files[0] ?? null;
}

export function filterStudioTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((node) => !(node.type === 'directory' && IGNORED_DIRS.has(node.name)))
    .map((node) => ({
      ...node,
      ...(node.children ? { children: filterStudioTree(node.children) } : {}),
    }));
}

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      ...(node.children ? { children: sortTree(node.children) } : {}),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function fileIconName(path: string): string {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|html|css)$/.test(lower)) return 'code';
  if (lower.endsWith('.json')) return 'json';
  if (/\.(md|txt|log)$/.test(lower)) return 'text';
  if (/\.(zip|tar|gz|tgz|rar|7z)$/.test(lower)) return 'archive';
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return 'image';
  return 'file';
}
