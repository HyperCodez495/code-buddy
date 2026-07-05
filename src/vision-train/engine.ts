/**
 * Vision-training loop engine: for each labeled scene, obtain an image, run the
 * robot's perception over it, and score against ground truth. Generation and
 * perception are INJECTED so the loop is hardware-agnostic and testable — the
 * CLI wires the real image_generate (ComfyUI/cloud) + object_detect (YOLO); a
 * "folder" mode skips generation and perceives provided images.
 */
import type { SceneSpec } from './curriculum.js';
import { scoreScene, aggregate, type ScenePerception, type SceneScore, type Benchmark } from './scorer.js';

export interface VisionTrainDeps {
  /** Resolve an image path for a scene (generate, or map to a provided file). */
  obtainImage: (spec: SceneSpec, index: number) => Promise<string>;
  /** Run perception over an image and return label counts. */
  perceive: (imagePath: string, spec: SceneSpec) => Promise<ScenePerception>;
  /** Progress hook (per scene). */
  onScene?: (info: { index: number; total: number; id: string; ok: boolean; error?: string }) => void;
}

export interface VisionTrainRunResult {
  scores: SceneScore[];
  benchmark: Benchmark;
  /** Scenes that failed to produce an image or perception (excluded from the benchmark). */
  failures: Array<{ id: string; error: string }>;
}

/**
 * Run the training loop over a curriculum. A scene whose image/perception throws
 * is recorded as a failure and skipped (fail-open per scene, never aborts the run).
 */
export async function runVisionTrain(
  specs: SceneSpec[],
  deps: VisionTrainDeps,
): Promise<VisionTrainRunResult> {
  const scores: SceneScore[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i]!;
    try {
      const imagePath = await deps.obtainImage(spec, i);
      const perception = await deps.perceive(imagePath, spec);
      const score = scoreScene(spec.id, spec.expect, perception, spec.tags);
      scores.push(score);
      deps.onScene?.({ index: i, total: specs.length, id: spec.id, ok: score.correct });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: spec.id, error: message });
      deps.onScene?.({ index: i, total: specs.length, id: spec.id, ok: false, error: message });
    }
  }

  return { scores, benchmark: aggregate(scores), failures };
}
