import { describe, expect, it } from 'vitest';
import { statusTone } from '../src/renderer/components/studio2/utils/deploy-model.js';
import { partitionChanges, canCommit } from '../src/renderer/components/studio2/utils/git-status-model.js';
import { computeLineDiff } from '../src/renderer/components/studio2/utils/diff-model.js';
import { canRestore, sortSnapshots } from '../src/renderer/components/studio2/utils/snapshot-model.js';
import { parseEditIntent } from '../src/renderer/components/studio2/utils/edit-intent.js';

describe('studio2 renderer models', () => {
  it('maps deploy status tones', () => { expect(statusTone('deploying')).toBe('info'); expect(statusTone('success')).toBe('success'); expect(statusTone('error')).toBe('danger'); });
  it('partitions git status and validates commits', () => { const groups = partitionChanges([{ status: 'M ', path: 'a.ts' }, { status: ' M', path: 'b.ts' }, { status: '??', path: 'c.ts' }]); expect(groups.staged).toHaveLength(1); expect(groups.modified).toHaveLength(1); expect(groups.untracked).toHaveLength(1); expect(canCommit('msg', groups.staged)).toBe(true); expect(canCommit(' ', groups.staged)).toBe(false); });
  it('computes LCS line diff', () => { expect(computeLineDiff('a\nb\nc', 'a\nc\nd').map((line) => line.kind + ':' + line.text)).toEqual(['unchanged:a', 'removed:b', 'unchanged:c', 'added:d']); });
  it('handles snapshots', () => { const snapshots = [{ id: '1', label: 'old', createdAt: '2026-01-01' }, { id: '2', label: 'new', createdAt: '2026-02-01' }]; expect(sortSnapshots(snapshots)[0].id).toBe('2'); expect(canRestore('1', snapshots)).toBe(true); expect(canRestore('x', snapshots)).toBe(false); });
  it('parses chat edit intents', () => { expect(parseEditIntent('ajoute un bouton dans src/App.tsx')).toMatchObject({ targetHint: 'src/App.tsx' }); expect(parseEditIntent('supprime le bouton').action).toContain('remove:'); });
});
