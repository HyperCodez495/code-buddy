/**
 * Seed coverage benchmark for self-authored SKILLS. Each scenario is a situation
 * the agent should have reusable guidance for; an authored skill "covers" it when
 * its content surfaces the expected terms. Curated separately from any proposer.
 *
 * @module agent/self-improvement/skill-benchmark
 */

import type { SkillBenchmarkScenario } from './skill-types.js';

export const SEED_SKILL_SCENARIOS: SkillBenchmarkScenario[] = [
  {
    id: 'git-bisect',
    query: 'find which commit introduced a regression',
    expectIncludes: ['git bisect', 'good', 'bad'],
    description: 'guidance for bisecting a regression',
  },
  {
    id: 'safe-delete',
    query: 'delete files safely without losing data',
    expectIncludes: ['backup', 'dry run', 'confirm'],
    description: 'guidance for deleting files safely',
  },
];
