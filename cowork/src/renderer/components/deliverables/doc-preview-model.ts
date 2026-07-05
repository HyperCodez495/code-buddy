export type DocBlockType = 'h1' | 'h2' | 'p' | 'quote' | 'code' | 'list';

export interface DocPreviewBlock {
  type: DocBlockType;
  text?: string;
  items?: string[];
}

export interface NormalizedDocBlock {
  type: DocBlockType;
  text?: string;
  items: string[];
  isEmpty: boolean;
}

export interface DocViewModel {
  blocks: NormalizedDocBlock[];
  heading: string;
  wordCount: number;
  isEmpty: boolean;
}

export function normalizeDocBlock(block: DocPreviewBlock): NormalizedDocBlock {
  const text = block.text?.trim() || undefined;
  const items = (block.items ?? []).map((item) => item.trim()).filter(Boolean);

  return {
    type: block.type,
    text,
    items,
    isEmpty: !text && items.length === 0,
  };
}

export function countDocWords(blocks: NormalizedDocBlock[]): number {
  return blocks.reduce((count, block) => {
    const textWords = block.text ? block.text.split(/\s+/u).filter(Boolean).length : 0;
    const itemWords = block.items.reduce((itemCount, item) => itemCount + item.split(/\s+/u).filter(Boolean).length, 0);
    return count + textWords + itemWords;
  }, 0);
}

export function buildDocViewModel(blocks: DocPreviewBlock[]): DocViewModel {
  const normalizedBlocks = blocks.map(normalizeDocBlock).filter((block) => !block.isEmpty);
  const firstHeading = normalizedBlocks.find((block) => block.type === 'h1' || block.type === 'h2');

  return {
    blocks: normalizedBlocks,
    heading: firstHeading?.text ?? 'Document sans titre',
    wordCount: countDocWords(normalizedBlocks),
    isEmpty: normalizedBlocks.length === 0,
  };
}
