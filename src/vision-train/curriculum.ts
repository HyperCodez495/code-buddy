/**
 * Synthetic perception curriculum: a deterministic set of labeled scenes with
 * domain randomization (how many people, lighting, framing). Each scene carries
 * a generation prompt AND its ground-truth counts, so a generated image is
 * self-labeled — the basis for scoring the robot's perception.
 *
 * Pure + deterministic (seeded by index, no Math.random) so a run is reproducible.
 */
import type { SceneExpectation } from './scorer.js';

export interface SceneSpec {
  id: string;
  /** Text-to-image prompt describing the scene. */
  prompt: string;
  /** Ground-truth label→count. */
  expect: SceneExpectation;
  /** Domain-randomization tags for per-condition analysis. */
  tags: string[];
}

export interface CurriculumOptions {
  /** Number of scenes to produce (clamped 1..200). Default 12. */
  count?: number;
  /** Object the "person" scenes should also contain (adds a labeled prop). */
  prop?: 'desk' | 'chair' | 'none';
}

const LIGHTING: Array<{ tag: string; phrase: string }> = [
  { tag: 'bright', phrase: 'in a bright, well-lit room' },
  { tag: 'low-light', phrase: 'in a dim, low-light room' },
  { tag: 'backlit', phrase: 'backlit by a bright window' },
  { tag: 'warm', phrase: 'under warm evening lighting' },
];

const FRAMING: Array<{ tag: string; phrase: string }> = [
  { tag: 'close', phrase: 'close-up, filling the frame' },
  { tag: 'mid', phrase: 'at mid distance' },
  { tag: 'far', phrase: 'far away across the room' },
];

// The person-count rotation drives presence detection (0 tests false positives).
const PERSON_COUNTS = [1, 1, 2, 0];

/**
 * Build a reproducible curriculum. Scene i deterministically selects a person
 * count, lighting and framing, producing a prompt + ground-truth counts.
 */
export function buildCurriculum(options: CurriculumOptions = {}): SceneSpec[] {
  const count = Math.max(1, Math.min(200, Math.round(options.count ?? 12)));
  const prop = options.prop ?? 'desk';
  const scenes: SceneSpec[] = [];

  for (let i = 0; i < count; i += 1) {
    const persons = PERSON_COUNTS[i % PERSON_COUNTS.length]!;
    const light = LIGHTING[i % LIGHTING.length]!;
    const frame = FRAMING[i % FRAMING.length]!;

    const counts: Record<string, number> = {};
    if (persons > 0) counts.person = persons;

    const subject =
      persons === 0
        ? 'an empty room with furniture, no people'
        : persons === 1
          ? 'one person'
          : `${persons} people`;

    let promptSubject = subject;
    if (persons > 0 && prop !== 'none') {
      counts[prop] = 1;
      promptSubject = `${subject} with a ${prop}`;
    }

    const tags = [light.tag, frame.tag, persons === 0 ? 'empty' : `p${persons}`];

    scenes.push({
      id: `scene-${String(i + 1).padStart(3, '0')}`,
      prompt: `Photorealistic photo of ${promptSubject}, ${frame.phrase}, ${light.phrase}. Sharp, natural, candid.`,
      expect: { counts },
      tags,
    });
  }

  return scenes;
}
