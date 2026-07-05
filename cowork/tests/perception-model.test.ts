import { describe, expect, it } from 'vitest';

import { countByExt, flattenTree, type FileNode } from '../src/renderer/utils/perception-model';

const tree: FileNode[] = [
  {
    name: 'src',
    path: '/repo/src',
    type: 'directory',
    children: [
      { name: 'index.ts', path: '/repo/src/index.ts', type: 'file' },
      { name: 'App.tsx', path: '/repo/src/App.tsx', type: 'file' },
    ],
  },
  { name: 'README', path: '/repo/README', type: 'file' },
];

describe('flattenTree', () => {
  it('returns directories and files in traversal order', () => {
    expect(flattenTree(tree).map((node) => node.path)).toEqual([
      '/repo/src',
      '/repo/src/index.ts',
      '/repo/src/App.tsx',
      '/repo/README',
    ]);
  });
});

describe('countByExt', () => {
  it('counts files by extension', () => {
    expect(countByExt(tree)).toEqual({ ts: 1, tsx: 1, none: 1 });
  });
});
