import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

export interface SkillCandidateReviewSummary {
  candidateChecksum?: string;
  candidateDiffPreview?: {
    addedLines: number;
    preview: string;
    removedLines: number;
    summary: string;
    truncated: boolean;
  };
  eligible: boolean;
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  kind: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
}

export interface ListSkillCandidateReviewOptions {
  eligibleOnly?: boolean;
  limit?: number;
  rootDir: string;
  skillRoot?: string;
}

interface ResearchScriptSkillCandidate {
  candidateChecksum?: string;
  candidateDiffPreview?: {
    addedLines: number;
    preview: string;
    removedLines: number;
    summary: string;
    truncated: boolean;
  };
  eligible: boolean;
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  kind?: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
}

interface ResearchScriptSkillCandidateModule {
  listMaterializedResearchScriptSkillCandidates: (options: {
    rootDir: string;
    skillRoot?: string;
  }) => Promise<ResearchScriptSkillCandidate[]>;
  listMaterializedResearchScriptSkillCandidatesWithInstallState?: (options: {
    rootDir: string;
    skillRoot?: string;
  }) => Promise<ResearchScriptSkillCandidate[]>;
}

export async function listSkillCandidatesForReview(
  options: ListSkillCandidateReviewOptions,
): Promise<SkillCandidateReviewSummary[]> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return [];

  const mod = await loadCoreModule<ResearchScriptSkillCandidateModule>(
    'agent/research-script-skill-candidate.js',
  );
  if (!mod?.listMaterializedResearchScriptSkillCandidates) return [];

  const listCandidates = mod.listMaterializedResearchScriptSkillCandidatesWithInstallState
    ?? mod.listMaterializedResearchScriptSkillCandidates;
  const candidates = await listCandidates({
    rootDir,
    skillRoot: normalizeSkillRoot(options.skillRoot),
  });
  const visible = options.eligibleOnly
    ? candidates.filter((candidate) => candidate.eligible)
    : candidates;

  return visible
    .slice(0, normalizeLimit(options.limit))
    .map(summarizeSkillCandidate);
}

function summarizeSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
): SkillCandidateReviewSummary {
  return {
    candidateChecksum: candidate.candidateChecksum,
    candidateDiffPreview: candidate.candidateDiffPreview,
    eligible: candidate.eligible,
    id: candidate.id,
    installState: candidate.installState,
    installedChecksum: candidate.installedChecksum,
    installedIntegrityOk: candidate.installedIntegrityOk,
    installedPath: candidate.installedPath,
    installedVersion: candidate.installedVersion,
    kind: candidate.kind ?? (candidate.sourceRunId ? 'learning' : 'research-script'),
    reason: candidate.reason,
    reviewCommands: candidate.reviewCommands,
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
    sourceJobId: candidate.sourceJobId,
    sourceRunId: candidate.sourceRunId,
    successfulRunCount: candidate.successfulRunCount,
    title: candidate.title,
    toolSequence: candidate.toolSequence,
  };
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeSkillRoot(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
