/**
 * Perception scorer for the synthetic vision-training loop.
 *
 * The premise ("train the brain" with synthetic data): a generated/known scene
 * carries its OWN ground truth (the prompt says "one person at a desk" ⇒ expect
 * {person:1, desk:1}). We run the robot's real perception (object_detect / YOLO)
 * over the image, then score detections against ground truth to find where
 * perception is weak — the feedback that drives improvement.
 *
 * Pure + deterministic: no IO, no LLM, no randomness. Fully unit-testable.
 */

/** Ground-truth label→count for one scene (the "answer key"). */
export interface SceneExpectation {
  counts: Record<string, number>;
}

/** What the robot's perception reported for one scene (from object_detect). */
export interface ScenePerception {
  countsByLabel: Record<string, number>;
}

export interface LabelScore {
  label: string;
  expected: number;
  detected: number;
  /** min(expected, detected) — correctly matched instances. */
  truePositives: number;
  /** max(0, expected − detected) — instances perception missed. */
  falseNegatives: number;
  /** max(0, detected − expected) — instances perception hallucinated. */
  falsePositives: number;
}

export interface SceneScore {
  id: string;
  tags: string[];
  /** Every expected label detected with the exact count, and no hallucinations. */
  correct: boolean;
  /** Sum over labels of |expected − detected|. 0 = perfect. */
  countError: number;
  labels: LabelScore[];
}

export interface LabelMetrics {
  label: string;
  support: number; // total expected instances
  detected: number; // total detected instances
  truePositives: number;
  precision: number; // tp / detected  (1 when nothing detected & nothing expected)
  recall: number; // tp / support   (1 when nothing expected)
}

export interface Benchmark {
  scenes: number;
  /** Fraction of scenes scored fully correct. */
  accuracy: number;
  /** Mean per-scene count error (lower is better). */
  meanCountError: number;
  perLabel: LabelMetrics[];
  /** Accuracy broken down by domain-randomization tag (e.g. low-light). */
  perTag: Array<{ tag: string; scenes: number; accuracy: number }>;
  /** Human-readable weaknesses, most severe first — the training signal. */
  weakSpots: string[];
}

const ROUND = (n: number): number => Math.round(n * 1000) / 1000;

/** Score one scene's perception against its ground truth. */
export function scoreScene(
  id: string,
  expectation: SceneExpectation,
  perception: ScenePerception,
  tags: string[] = [],
): SceneScore {
  const expected = expectation.counts ?? {};
  const detected = perception.countsByLabel ?? {};
  const allLabels = new Set<string>([...Object.keys(expected), ...Object.keys(detected)]);

  const labels: LabelScore[] = [];
  let countError = 0;
  let correct = true;

  for (const label of [...allLabels].sort()) {
    const e = Math.max(0, Math.round(expected[label] ?? 0));
    const d = Math.max(0, Math.round(detected[label] ?? 0));
    const tp = Math.min(e, d);
    const fn = Math.max(0, e - d);
    const fp = Math.max(0, d - e);
    countError += Math.abs(e - d);
    if (fn > 0 || fp > 0) correct = false;
    labels.push({ label, expected: e, detected: d, truePositives: tp, falseNegatives: fn, falsePositives: fp });
  }

  return { id, tags, correct, countError, labels };
}

/** Aggregate per-scene scores into a benchmark + weakness report. */
export function aggregate(scores: SceneScore[]): Benchmark {
  const sceneCount = scores.length;
  if (sceneCount === 0) {
    return { scenes: 0, accuracy: 0, meanCountError: 0, perLabel: [], perTag: [], weakSpots: [] };
  }

  const correctCount = scores.filter((s) => s.correct).length;
  const totalCountError = scores.reduce((sum, s) => sum + s.countError, 0);

  // Per-label precision/recall over the whole run.
  const agg = new Map<string, { support: number; detected: number; tp: number }>();
  for (const scene of scores) {
    for (const l of scene.labels) {
      const cur = agg.get(l.label) ?? { support: 0, detected: 0, tp: 0 };
      cur.support += l.expected;
      cur.detected += l.detected;
      cur.tp += l.truePositives;
      agg.set(l.label, cur);
    }
  }
  const perLabel: LabelMetrics[] = [...agg.entries()]
    .map(([label, m]) => ({
      label,
      support: m.support,
      detected: m.detected,
      truePositives: m.tp,
      precision: m.detected === 0 ? (m.support === 0 ? 1 : 0) : ROUND(m.tp / m.detected),
      recall: m.support === 0 ? 1 : ROUND(m.tp / m.support),
    }))
    .sort((a, b) => b.support - a.support);

  // Per-tag accuracy (domain-randomization slices).
  const tagAgg = new Map<string, { scenes: number; correct: number }>();
  for (const scene of scores) {
    for (const tag of scene.tags) {
      const cur = tagAgg.get(tag) ?? { scenes: 0, correct: 0 };
      cur.scenes += 1;
      if (scene.correct) cur.correct += 1;
      tagAgg.set(tag, cur);
    }
  }
  const perTag = [...tagAgg.entries()]
    .map(([tag, m]) => ({ tag, scenes: m.scenes, accuracy: ROUND(m.correct / m.scenes) }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const weakSpots = buildWeakSpots(perLabel, perTag, ROUND(correctCount / sceneCount));

  return {
    scenes: sceneCount,
    accuracy: ROUND(correctCount / sceneCount),
    meanCountError: ROUND(totalCountError / sceneCount),
    perLabel,
    perTag,
    weakSpots,
  };
}

function buildWeakSpots(
  perLabel: LabelMetrics[],
  perTag: Array<{ tag: string; scenes: number; accuracy: number }>,
  overallAccuracy: number,
): string[] {
  const spots: Array<{ severity: number; text: string }> = [];

  for (const m of perLabel) {
    if (m.support > 0 && m.recall < 0.7) {
      spots.push({
        severity: 1 - m.recall,
        text: `Misses "${m.label}" — recall ${(m.recall * 100).toFixed(0)}% (${m.truePositives}/${m.support} found)`,
      });
    }
    if (m.detected > 0 && m.precision < 0.7) {
      spots.push({
        severity: 1 - m.precision,
        text: `Over-detects "${m.label}" — precision ${(m.precision * 100).toFixed(0)}% (${m.detected - m.truePositives} false)`,
      });
    }
  }

  // A tag that scores materially below the overall accuracy is a weak condition.
  for (const t of perTag) {
    if (t.scenes >= 2 && t.accuracy + 0.15 < overallAccuracy) {
      spots.push({
        severity: overallAccuracy - t.accuracy,
        text: `Struggles under "${t.tag}" — ${(t.accuracy * 100).toFixed(0)}% vs ${(overallAccuracy * 100).toFixed(0)}% overall`,
      });
    }
  }

  return spots.sort((a, b) => b.severity - a.severity).map((s) => s.text);
}
