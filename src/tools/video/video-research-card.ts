/**
 * Deterministic research-intake card for an understood video.
 *
 * This is deliberately NOT an LLM summary. It scans the complete transcript,
 * groups neighbouring captions into readable windows, and surfaces passages
 * likely to contain technologies or externally-verifiable claims. The card is
 * a compact map that helps the main agent inspect a long video without drawing
 * conclusions from the first truncated transcript chunk.
 */

export interface VideoResearchCardSegment {
  t_start: number;
  t_end: number;
  said: string;
}

export interface VideoResearchCardInput {
  source: string;
  method: string;
  transcriptPath: string;
  segments: VideoResearchCardSegment[];
  question?: string;
  cloudAnswer?: string;
}

interface TranscriptWindow {
  start: number;
  end: number;
  text: string;
}

const WINDOW_SECONDS = 30;
const MAX_WINDOW_CHARS = 650;
const MAX_TECH_SIGNALS = 8;
const MAX_CLAIM_SIGNALS = 8;
const MAX_PREVIEW_SIGNALS = 3;
const MAX_PREVIEW_WINDOW_CHARS = 320;

const TECHNOLOGY_PATTERN = /\b(?:ai|ia|llm|mod[eè]le|syst[eè]me|architecture|multi[- ]?agent|agentique|robot|avatar|world model|mod[eè]le monde|open source|github|gpu|transformer|diffusion|vision|g[eé]nom|adn|arn|rna|prot[eé]ine|logiciel|framework|api)\b/gi;
const CLAIM_PATTERN = /(?:\d+(?:[.,]\d+)?\s*(?:%|x|fois|millions?|milliards?|tokens?|param[eè]tres?|gpu|jours?|heures?|fps|images? par seconde)|benchmark|score|plus rapide|publi[eé]|publication|nature|laboratoire|exp[eé]rimental|confirm[eé]|open source|disponible sur github)/gi;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeInline(value: string): string {
  return collapseWhitespace(value).replace(/`/g, '\\`');
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(remaining)}`
    : `${minutes}:${pad(remaining)}`;
}

function truncate(value: string, maxChars: number): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  const cut = normalized.slice(0, Math.max(0, maxChars - 1));
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > maxChars * 0.65 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function buildTranscriptWindows(segments: VideoResearchCardSegment[]): TranscriptWindow[] {
  const windows: TranscriptWindow[] = [];
  let current: TranscriptWindow | null = null;

  for (const segment of segments) {
    const text = collapseWhitespace(segment.said ?? '');
    if (!text) continue;
    if (
      !current ||
      segment.t_start - current.start >= WINDOW_SECONDS ||
      current.text.length + text.length + 1 > MAX_WINDOW_CHARS
    ) {
      if (current) windows.push(current);
      current = {
        start: segment.t_start,
        end: segment.t_end,
        text,
      };
      continue;
    }
    current.end = Math.max(current.end, segment.t_end);
    current.text = `${current.text} ${text}`;
  }
  if (current) windows.push(current);
  return windows;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function selectSignals(
  windows: TranscriptWindow[],
  pattern: RegExp,
  limit: number,
): TranscriptWindow[] {
  return windows
    .map((window, index) => ({
      window,
      index,
      score: countMatches(window.text, pattern),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => candidate.window);
}

function renderSignals(
  windows: TranscriptWindow[],
  maxChars = MAX_WINDOW_CHARS,
): string {
  if (windows.length === 0) return '- Aucun passage détecté automatiquement.';
  return windows
    .map((window) => `- **${formatTimestamp(window.start)}** — ${truncate(window.text, maxChars)}`)
    .join('\n');
}

function extractUrls(segments: VideoResearchCardSegment[]): string[] {
  const urls = new Set<string>();
  for (const segment of segments) {
    for (const match of segment.said.match(URL_PATTERN) ?? []) {
      urls.add(match.replace(/[.,;:!?]+$/g, ''));
    }
  }
  return [...urls].slice(0, 20);
}

/** Build a compact, evidence-first Markdown intake card from the full transcript. */
export function buildVideoResearchCard(input: VideoResearchCardInput): string {
  const windows = buildTranscriptWindows(input.segments);
  const technologySignals = selectSignals(
    windows,
    TECHNOLOGY_PATTERN,
    MAX_TECH_SIGNALS,
  );
  const claimSignals = selectSignals(windows, CLAIM_PATTERN, MAX_CLAIM_SIGNALS);
  const urls = extractUrls(input.segments);
  const duration = input.segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.t_end),
    0,
  );
  const question = safeInline(input.question ?? '');
  const cloudAnswer = collapseWhitespace(input.cloudAnswer ?? '');

  const sections = [
    '# Fiche de recherche vidéo',
    '',
    '> Pré-ingestion automatique. Les passages ci-dessous viennent du transcript ; ils ne constituent pas une validation scientifique ou factuelle.',
    '',
    `- **Source :** \`${safeInline(input.source)}\``,
    `- **Méthode :** ${safeInline(input.method)}`,
    `- **Couverture :** ${input.segments.length} segments, jusqu’à ${formatTimestamp(duration)}`,
    `- **Transcript complet :** \`${safeInline(input.transcriptPath)}\``,
    '',
    '## Demande',
    '',
    question || 'Analyse générale de la vidéo partagée.',
    '',
    '## Passages technologiques à examiner',
    '',
    renderSignals(technologySignals),
    '',
    '## Affirmations à vérifier dans des sources primaires',
    '',
    renderSignals(claimSignals),
    '',
    '## Liens mentionnés dans le transcript',
    '',
    urls.length > 0 ? urls.map((url) => `- ${url}`).join('\n') : '- Aucun lien explicite détecté.',
  ];

  if (cloudAnswer) {
    sections.push(
      '',
      '## Synthèse cloud disponible (non vérifiée)',
      '',
      truncate(cloudAnswer, 2_500),
    );
  }

  sections.push(
    '',
    '## Prochaine étape recommandée',
    '',
    '1. Identifier les noms propres possiblement déformés par la transcription.',
    '2. Retrouver les publications, dépôts et annonces officiels.',
    '3. Séparer faits vérifiés, affirmations de la vidéo et inférences.',
    '4. Proposer des expériences bornées avant toute intégration dans Code Buddy.',
    '',
  );

  return sections.join('\n');
}

/**
 * Render a bounded preview for the immediate tool observation.
 *
 * Long transcripts are truncated before they reach the main model. Including
 * a few signals selected from the complete transcript prevents the model from
 * answering only from the opening minutes while keeping the observation small.
 */
export function buildVideoResearchCardPreview(
  input: VideoResearchCardInput,
): string {
  const windows = buildTranscriptWindows(input.segments);
  const technologySignals = selectSignals(
    windows,
    TECHNOLOGY_PATTERN,
    MAX_PREVIEW_SIGNALS,
  );
  const claimSignals = selectSignals(
    windows,
    CLAIM_PATTERN,
    MAX_PREVIEW_SIGNALS,
  );

  if (technologySignals.length === 0 && claimSignals.length === 0) return '';

  return [
    '## Aperçu de recherche (transcript complet)',
    '',
    '> Indices automatiques, non vérifiés. Confirmer les noms et affirmations dans des sources primaires.',
    '',
    '### Technologies et projets mentionnés',
    '',
    renderSignals(technologySignals, MAX_PREVIEW_WINDOW_CHARS),
    '',
    '### Affirmations à vérifier',
    '',
    renderSignals(claimSignals, MAX_PREVIEW_WINDOW_CHARS),
  ].join('\n');
}
