import { FileText } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { buildDocViewModel, type DocPreviewBlock, type NormalizedDocBlock } from './doc-preview-model.js';

export interface DocPreviewProps {
  blocks: DocPreviewBlock[];
}

function DocBlock({ block }: { block: NormalizedDocBlock }) {
  switch (block.type) {
    case 'h1':
      return <h1 className="text-3xl font-semibold tracking-tight text-foreground">{block.text}</h1>;
    case 'h2':
      return <h2 className="pt-4 text-xl font-semibold text-foreground">{block.text}</h2>;
    case 'quote':
      return <blockquote className="border-l-4 border-border bg-muted px-4 py-3 text-muted-foreground">{block.text}</blockquote>;
    case 'code':
      return <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 text-sm text-foreground"><code>{block.text}</code></pre>;
    case 'list':
      return <ul className="space-y-2 text-foreground">{block.items.map((item, index) => <li key={index} className="flex gap-3"><span aria-hidden="true">•</span><span>{item}</span></li>)}</ul>;
    case 'p':
    default:
      return <p className="leading-7 text-foreground">{block.text}</p>;
  }
}

export function DocPreview({ blocks }: DocPreviewProps) {
  const model = buildDocViewModel(blocks);

  if (model.isEmpty) {
    return <EmptyState icon={<FileText className="h-6 w-6" />} title="Document vide" hint="Aucun bloc de document à prévisualiser." />;
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-4" aria-label="Aperçu de document">
      <header className="mb-5 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground tabular-nums">{model.wordCount} mots</p>
        <h2 className="mt-1 text-sm font-medium text-foreground">{model.heading}</h2>
      </header>
      <div className="mx-auto max-w-3xl space-y-5 rounded-md border border-border bg-background p-6 font-serif">
        {model.blocks.map((block, index) => <DocBlock key={index} block={block} />)}
      </div>
    </article>
  );
}
