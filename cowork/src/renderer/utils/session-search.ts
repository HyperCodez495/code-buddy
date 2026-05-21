import type { Message } from '../types';

export function extractMessageSearchText(message: Message): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thinking;
      if (block.type === 'tool_result') return block.content;
      if (block.type === 'tool_use') return `${block.name} ${JSON.stringify(block.input)}`;
      if (block.type === 'file_attachment') return block.filename;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function findMessageSearchMatches(messages: Message[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return messages
    .filter((message) => extractMessageSearchText(message).toLowerCase().includes(normalizedQuery))
    .map((message) => message.id);
}

export function clampSearchMatchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), matchCount - 1);
}

export function getActiveSearchMatchId(matches: string[], index: number): string | null {
  if (matches.length === 0) return null;
  return matches[clampSearchMatchIndex(index, matches.length)] ?? null;
}
