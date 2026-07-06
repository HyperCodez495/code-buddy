/**
 * pickDefaultFile / flattenFiles — real test (no mocks): the bolt.new workbench
 * opens the most relevant file on load.
 */
import { describe, expect, it } from 'vitest';
import { flattenFiles, pickDefaultFile } from '../src/renderer/components/studio/utils/file-tree-model';
import type { TreeNode } from '../src/renderer/components/studio/utils/file-tree-model';

const tree: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file' },
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
    ],
  },
  { name: 'package.json', path: 'package.json', type: 'file' },
  { name: 'README.md', path: 'README.md', type: 'file' },
];

describe('flattenFiles', () => {
  it('lists every file path depth-first', () => {
    expect(flattenFiles(tree)).toEqual(['src/main.tsx', 'src/App.tsx', 'package.json', 'README.md']);
  });
});

describe('pickDefaultFile', () => {
  it('prefers src/App.tsx over main/package', () => {
    expect(pickDefaultFile(tree)).toBe('src/App.tsx');
  });

  it('falls back down the preference list, then to the first file', () => {
    expect(pickDefaultFile([{ name: 'package.json', path: 'package.json', type: 'file' }])).toBe('package.json');
    expect(
      pickDefaultFile([
        { name: 'weird.xyz', path: 'weird.xyz', type: 'file' },
        { name: 'other.bin', path: 'other.bin', type: 'file' },
      ]),
    ).toBe('weird.xyz');
  });

  it('returns null for an empty or directory-only tree', () => {
    expect(pickDefaultFile([])).toBeNull();
    expect(pickDefaultFile([{ name: 'empty', path: 'empty', type: 'directory', children: [] }])).toBeNull();
  });
});
