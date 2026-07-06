/**
 * static-project-model — real test (no mocks): static vs dev-server detection.
 */
import { describe, expect, it } from 'vitest';
import {
  isStaticProject,
  previewEntry,
  describePreviewMode,
} from '../src/renderer/components/studio/static-project-model';
import type { TreeNode } from '../src/renderer/components/studio/utils/file-tree-model';

const staticTree: TreeNode[] = [
  { name: 'index.html', path: 'index.html', type: 'file' },
  { name: 'style.css', path: 'style.css', type: 'file' },
  { name: 'app.js', path: 'app.js', type: 'file' },
];

const viteTree: TreeNode[] = [
  { name: 'index.html', path: 'index.html', type: 'file' },
  { name: 'package.json', path: 'package.json', type: 'file' },
  { name: 'src', path: 'src', type: 'directory', children: [{ name: 'main.tsx', path: 'src/main.tsx', type: 'file' }] },
];

describe('static-project-model', () => {
  it('detects a static project (index.html, no package.json)', () => {
    expect(isStaticProject(staticTree)).toBe(true);
    expect(describePreviewMode(staticTree)).toBe('static');
  });

  it('detects a dev-server project (has package.json)', () => {
    expect(isStaticProject(viteTree)).toBe(false);
    expect(describePreviewMode(viteTree)).toBe('dev-server');
  });

  it('finds the static entry path', () => {
    expect(previewEntry(staticTree)).toBe('index.html');
    expect(previewEntry([{ name: 'src', path: 'src', type: 'directory' }])).toBeNull();
  });
});
