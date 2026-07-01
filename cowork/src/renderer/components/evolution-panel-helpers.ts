/**
 * Pure helpers for the Evolution panel (new-shell Labs) — lists the versions of Code Buddy the
 * recursive self-improvement loop generated (`buddy evolve`). Kept pure + unit-tested; the panel is
 * a thin renderer, the data comes from the core CodeVariantStore via the `evolve.listVariants` IPC.
 */

/** Mirror of the core `VariantRecord` (renderer can't import core types directly). */
export interface EvolvedVariant {
  id: string;
  branch: string;
  sha: string;
  score: number;
  passedAll: boolean;
  regressions: string[];
  createdAt: string;
  detail?: string;
  /** The mutation plan that produced this version (goal + inspirations the mutator followed). */
  plan?: string;
  behavior?: string;
  parents?: string[];
  generation?: number;
}

export interface GenerationGroup {
  generation: number;
  variants: EvolvedVariant[];
}

export function variantGeneration(v: EvolvedVariant): number {
  return typeof v.generation === 'number' && v.generation >= 0 ? v.generation : 0;
}

/**
 * Group variants by generation (ascending), variants within a generation by score (descending).
 * The genealogy view of recursive self-improvement: generation 0 = children of the baseline,
 * each next generation built with the prior elites as inspiration.
 */
export function groupByGeneration(variants: readonly EvolvedVariant[]): GenerationGroup[] {
  const byGen = new Map<number, EvolvedVariant[]>();
  for (const v of variants) {
    const g = variantGeneration(v);
    const bucket = byGen.get(g) ?? [];
    bucket.push(v);
    byGen.set(g, bucket);
  }
  return [...byGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, vs]) => ({
      generation,
      variants: [...vs].sort((a, b) => b.score - a.score),
    }));
}

/** Is this variant a keepable winner (passed everything, no regression)? For a "best" badge. */
export function isWinner(v: EvolvedVariant): boolean {
  return v.passedAll && v.regressions.length === 0;
}
