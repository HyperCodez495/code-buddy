import { computeLineDiff } from './utils/diff-model.js';
export interface DiffViewProps { before: string; after: string; path: string; mode?: 'unified' | 'split'; }
export function DiffView({ before, after, path, mode = 'unified' }: DiffViewProps) { const diff = computeLineDiff(before, after); return <section className={'studio2-diff mode-' + mode}><h3>{path}</h3><ol>{diff.map((line, index) => <li key={index} className={'diff-' + line.kind}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span><code>{line.text}</code></li>)}</ol></section>; }
export default DiffView;
