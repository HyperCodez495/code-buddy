import type { FocusedMessageTarget } from '../store';

export type SearchSource = 'session' | 'message' | 'memory' | 'knowledge' | 'file';

export interface GlobalSearchHit {
  source: SearchSource;
  id: string;
  title: string;
  snippet: string;
  score: number;
  context: {
    sessionId?: string;
    projectId?: string;
    messageIndex?: number;
    messageId?: string;
    path?: string;
  };
}

export interface GlobalSearchResults {
  hits: GlobalSearchHit[];
  totalByCategory: Record<SearchSource, number>;
}

export const SOURCE_ORDER: SearchSource[] = ['session', 'message', 'memory', 'knowledge', 'file'];

export function groupGlobalSearchHits(
  hits: GlobalSearchHit[]
): Record<SearchSource, GlobalSearchHit[]> {
  const groups: Record<SearchSource, GlobalSearchHit[]> = {
    session: [],
    message: [],
    memory: [],
    knowledge: [],
    file: [],
  };
  for (const hit of hits) {
    groups[hit.source].push(hit);
  }
  return groups;
}

export function buildGlobalSearchFocusedMessageTarget(
  hit: GlobalSearchHit
): FocusedMessageTarget | null {
  if (hit.source !== 'message') return null;
  const sessionId = hit.context.sessionId?.trim();
  const messageId = hit.context.messageId?.trim();
  if (!sessionId || !messageId) return null;
  return { sessionId, messageId };
}
