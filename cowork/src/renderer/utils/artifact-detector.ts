/**
 * Artifact Detector — Claude Cowork parity Phase 2 step 10
 *
 * Scans assistant message content for renderable artifacts inside fenced
 * code blocks. Detects HTML, SVG, Mermaid diagrams, React/JSX snippets,
 * and standalone JSON visualizations.
 *
 * @module renderer/utils/artifact-detector
 */

export type RenderableArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'json';

export interface RenderableArtifact {
  id: string;
  kind: RenderableArtifactKind;
  language: string;
  source: string;
  title?: string;
}

const FENCE_REGEX = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;

const KIND_BY_LANGUAGE: Record<string, RenderableArtifactKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'react',
  tsx: 'react',
  react: 'react',
  json: 'json',
};

function detectKind(language: string, code: string): RenderableArtifactKind | null {
  const lang = language.toLowerCase().trim();
  if (KIND_BY_LANGUAGE[lang]) {
    return KIND_BY_LANGUAGE[lang];
  }

  const head = code.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  if (head.startsWith('<svg')) return 'svg';
  if (
    head.startsWith('graph ') ||
    head.startsWith('flowchart ') ||
    head.startsWith('sequencediagram') ||
    head.startsWith('classdiagram') ||
    head.startsWith('statediagram') ||
    head.startsWith('erdiagram') ||
    head.startsWith('gantt') ||
    head.startsWith('pie ')
  ) {
    return 'mermaid';
  }

  return null;
}

function inferTitle(kind: RenderableArtifactKind, source: string): string | undefined {
  if (kind === 'html' || kind === 'svg') {
    const match = source.match(/<title>([^<]+)<\/title>/i);
    if (match) return match[1].trim();
    return undefined;
  }
  if (kind === 'mermaid') {
    const firstLine = source.split('\n').find((l) => l.trim());
    return firstLine?.slice(0, 60);
  }
  if (kind === 'react') {
    const compMatch = source.match(/(?:function|const)\s+([A-Z]\w*)/);
    return compMatch ? compMatch[1] : undefined;
  }
  if (kind === 'json') {
    return inferJsonTitle(source);
  }
  return undefined;
}

function inferJsonTitle(source: string): string | undefined {
  try {
    const value = JSON.parse(source) as unknown;
    if (!isRecord(value)) {
      return undefined;
    }

    if (value.kind === 'agentic-coding-harness-contract') {
      return 'Agentic harness contract';
    }

    if (
      value.kind === 'agentic-coding-proposal-loop-cowork-workspace' &&
      isRecord(value.harness) &&
      value.harness.kind === 'agentic-coding-harness-contract'
    ) {
      return 'Agentic Cowork workspace harness';
    }

    if (typeof value.kind === 'string') {
      return value.kind.slice(0, 60);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function detectArtifacts(text: string): RenderableArtifact[] {
  if (!text) return [];

  const artifacts: RenderableArtifact[] = [];
  const seen = new Set<string>();

  FENCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_REGEX.exec(text))) {
    const language = match[1] ?? '';
    const source = (match[2] ?? '').trimEnd();
    if (!source) continue;

    const kind = detectKind(language, source);
    if (!kind) continue;
    if (source.length < 16) continue;

    const id = simpleHash(`${kind}:${source}`);
    if (seen.has(id)) continue;
    seen.add(id);

    artifacts.push({
      id,
      kind,
      language: language || kind,
      source,
      title: inferTitle(kind, source),
    });
  }

  return artifacts;
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return `art_${(h >>> 0).toString(36)}`;
}
