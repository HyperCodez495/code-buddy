/**
 * Detect whether a generated project is a static site (index.html, no build) or
 * a dev-server project (package.json). App Studio's generator often writes
 * static HTML/CSS/JS — the preview must be served differently. Pure.
 */
import type { TreeNode } from './utils/file-tree-model.js';

export type PreviewMode = 'static' | 'dev-server';

function rootFiles(tree: readonly TreeNode[]): string[] {
  return tree.filter((n) => n.type === 'file').map((n) => n.name.toLowerCase());
}

/** A static project has a root index.html and no package.json. */
export function isStaticProject(tree: readonly TreeNode[]): boolean {
  const files = rootFiles(tree);
  return files.includes('index.html') && !files.includes('package.json');
}

/** Path to the static entry (root index.html), or null. */
export function previewEntry(tree: readonly TreeNode[]): string | null {
  const entry = tree.find((n) => n.type === 'file' && n.name.toLowerCase() === 'index.html');
  return entry?.path ?? null;
}

export function describePreviewMode(tree: readonly TreeNode[]): PreviewMode {
  return isStaticProject(tree) ? 'static' : 'dev-server';
}
