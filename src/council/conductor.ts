/**
 * Council conductor — capability requirements, panel diversity, complementary
 * roles and their assignment to ranked candidates.
 *
 * @module council/conductor
 */

import type { ModelScoreboard } from '../fleet/model-scoreboard.js';
import type { ModelStrength } from '../fleet/types.js';
import type { CouncilConductorPlan, CouncilRole, RankedCandidate } from './types.js';

export const TASK_REQUIRES: Record<string, ModelStrength[]> = {
  code: ['code', 'reasoning'],
  reasoning: ['reasoning', 'thinking'],
  french: ['french', 'reasoning'],
  vision: ['vision'],
  general: ['reasoning', 'fast'],
};

export function matchScore(strengths: ModelStrength[], required: ModelStrength[]): number {
  if (required.length === 0) return 0.5;
  const have = new Set(strengths);
  const hits = required.filter((r) => have.has(r)).length;
  return hits / required.length;
}

/** Pick top-K, favouring distinct providers for genuine diversity. */
export function pickDiverse(ranked: RankedCandidate[], k: number): RankedCandidate[] {
  const picked: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (seen.has(r.c.provider)) continue;
    seen.add(r.c.provider);
    picked.push(r);
  }
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

export function assignCouncilRolesToCandidates(
  picked: RankedCandidate[],
  roles: CouncilRole[],
  taskType: string,
  scoreboard: Pick<ModelScoreboard, 'roleScore'>,
): RankedCandidate[] {
  const localRoles = roles.slice(0, picked.length);
  if (picked.length < 2 || localRoles.length < 2) return picked;

  const roleScore = (ordered: RankedCandidate[]): number =>
    ordered.reduce((sum, candidate, index) => {
      const role = localRoles[index];
      return sum + (role ? scoreboard.roleScore(taskType, role.id, candidate.c.model) : 0);
    }, 0);

  let best = picked;
  let bestScore = roleScore(picked);
  if (picked.length <= 6) {
    const remaining = [...picked];
    const current: RankedCandidate[] = [];
    const visit = (): void => {
      if (current.length === picked.length) {
        const score = roleScore(current);
        if (score > bestScore + Number.EPSILON) {
          best = [...current];
          bestScore = score;
        }
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const [candidate] = remaining.splice(i, 1);
        current.push(candidate!);
        visit();
        current.pop();
        remaining.splice(i, 0, candidate!);
      }
    };
    visit();
  } else {
    const remaining = [...picked];
    const assigned: RankedCandidate[] = [];
    for (const role of localRoles) {
      let bestIndex = 0;
      let bestCandidateScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        const score = scoreboard.roleScore(taskType, role.id, remaining[i]!.c.model);
        if (score > bestCandidateScore) {
          bestIndex = i;
          bestCandidateScore = score;
        }
      }
      assigned.push(remaining.splice(bestIndex, 1)[0]!);
    }
    const assignedScore = roleScore(assigned);
    if (assignedScore > bestScore + Number.EPSILON) {
      best = assigned;
      bestScore = assignedScore;
    }
  }

  return bestScore > 0 ? best : picked;
}

export const DIRECT_ROLE: CouncilRole = {
  id: 'direct',
  label: 'Direct answer',
  mission: 'Answer the user task directly with the best complete response.',
  focus: ['correctness', 'usefulness', 'clear assumptions'],
};

const ROLE_SETS: Record<string, CouncilRole[]> = {
  code: [
    {
      id: 'architect',
      label: 'Architect',
      mission: 'Design the clean technical approach before implementation.',
      focus: ['architecture', 'interfaces', 'integration risk'],
    },
    {
      id: 'implementer',
      label: 'Implementer',
      mission: 'Find the practical implementation path and concrete next edits.',
      focus: ['minimal viable changes', 'existing code patterns', 'test impact'],
    },
    {
      id: 'reviewer',
      label: 'Reviewer',
      mission: 'Attack the proposal as a code reviewer and find regressions.',
      focus: ['bugs', 'security', 'missing tests'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission: 'Define how to prove the answer or change is correct.',
      focus: ['test plan', 'observability', 'rollback'],
    },
  ],
  reasoning: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Build the strongest high-level solution.',
      focus: ['goal decomposition', 'tradeoffs', 'decision criteria'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission: 'Look for flawed assumptions and counterexamples.',
      focus: ['failure modes', 'hidden constraints', 'overconfidence'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission: 'Check the reasoning and propose validation steps.',
      focus: ['evidence', 'consistency', 'what would falsify this'],
    },
  ],
  french: [
    {
      id: 'clarifier',
      label: 'Clarificateur',
      mission: 'Reformuler le besoin et proposer une réponse claire.',
      focus: ['nuance', 'structure', 'français naturel'],
    },
    {
      id: 'critique',
      label: 'Critique',
      mission: 'Repérer les ambiguïtés et les risques d’interprétation.',
      focus: ['contresens', 'hypothèses', 'points à demander'],
    },
    {
      id: 'synthesizer',
      label: 'Synthèse',
      mission: 'Produire la version finale la plus utile et concise.',
      focus: ['priorités', 'clarté', 'action suivante'],
    },
  ],
  vision: [
    {
      id: 'observer',
      label: 'Observer',
      mission: 'Extract the visual facts carefully without overclaiming.',
      focus: ['visible evidence', 'uncertainty', 'missing context'],
    },
    {
      id: 'risk-reviewer',
      label: 'Risk reviewer',
      mission: 'Challenge visual assumptions and unsafe conclusions.',
      focus: ['false positives', 'privacy', 'safety'],
    },
    {
      id: 'practical-synthesizer',
      label: 'Practical synthesizer',
      mission: 'Turn observations into an actionable answer.',
      focus: ['user goal', 'next step', 'confidence'],
    },
  ],
  general: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Find the best overall answer and useful framing.',
      focus: ['user intent', 'options', 'tradeoffs'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission: 'Find what could be wrong, missing, or risky.',
      focus: ['assumptions', 'edge cases', 'cost of being wrong'],
    },
    {
      id: 'practitioner',
      label: 'Practitioner',
      mission: 'Make the answer operational and concrete.',
      focus: ['steps', 'constraints', 'what to do now'],
    },
  ],
};

function isCollectiveTask(task: string, taskType: string, count: number): boolean {
  if (count < 2) return false;
  const text = task.toLowerCase();
  if (task.length > 180) return true;
  if (taskType === 'code' || taskType === 'reasoning' || taskType === 'vision') return true;
  return /\b(audit|analyse|architecture|modernise|refactor|sécurité|security|risque|risk|compare|versus|vs|plan|stratégie|strategy|design|review|vérifie|verify|complexe|deep|fond)\b/.test(text);
}

export function buildCouncilConductorPlan(
  task: string,
  taskType: string,
  count: number,
  enabled = true,
): CouncilConductorPlan {
  if (!enabled || !isCollectiveTask(task, taskType, count)) {
    return {
      mode: 'direct',
      reason: enabled ? 'simple task: direct fan-out' : 'disabled by option',
      roles: Array.from({ length: Math.max(1, count) }, () => DIRECT_ROLE),
    };
  }

  const base = ROLE_SETS[taskType] ?? ROLE_SETS.general!;
  const roles = Array.from({ length: count }, (_, index) => {
    const role = base[index % base.length]!;
    if (index < base.length) return role;
    // Extra seats keep the SAME role id: the scoreboard learns per stable role
    // id, and a suffixed id ('reviewer-4') would fragment that history by
    // panel position. Only the label is disambiguated for display.
    return {
      ...role,
      label: `${role.label} ${index + 1}`,
      focus: [...role.focus, 'independent angle'],
    };
  });
  return {
    mode: 'collective',
    reason: 'complex task: complementary council roles',
    roles,
  };
}

export function buildCouncilPrompt(task: string, plan: CouncilConductorPlan, roleIndex: number): string {
  const role = plan.roles[roleIndex] ?? DIRECT_ROLE;
  if (plan.mode === 'direct' || role.id === DIRECT_ROLE.id) return task;

  return [
    `You are the ${role.label} in Code Buddy Council.`,
    role.mission,
    '',
    'Focus on:',
    ...role.focus.map((item) => `- ${item}`),
    '',
    'Original user task:',
    task,
    '',
    'Return an independent answer from this role. Be concrete. Name assumptions and risks. Do not imitate a generic consensus answer.',
  ].join('\n');
}
