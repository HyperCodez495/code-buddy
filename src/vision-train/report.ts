/**
 * Human-readable benchmark report for a vision-training run. Pure string
 * rendering — the engine writes this to .codebuddy/vision-train/.
 */
import type { Benchmark } from './scorer.js';

export function renderReport(benchmark: Benchmark, meta: { source: string; model?: string }): string {
  const lines: string[] = [];
  lines.push('# Vision-training perception benchmark', '');
  lines.push(`- Scenes: **${benchmark.scenes}**`);
  lines.push(`- Accuracy (fully-correct scenes): **${pct(benchmark.accuracy)}**`);
  lines.push(`- Mean count error: **${benchmark.meanCountError}**`);
  lines.push(`- Image source: ${meta.source}`);
  if (meta.model) lines.push(`- Perception model: ${meta.model}`);
  lines.push('');

  if (benchmark.weakSpots.length > 0) {
    lines.push('## Weak spots (training signal)', '');
    for (const w of benchmark.weakSpots) lines.push(`- ${w}`);
    lines.push('');
  } else {
    lines.push('## Weak spots', '', '- None — perception matched ground truth across the curriculum.', '');
  }

  if (benchmark.perLabel.length > 0) {
    lines.push('## Per-label', '', '| label | support | detected | precision | recall |', '|---|---|---|---|---|');
    for (const m of benchmark.perLabel) {
      lines.push(`| ${m.label} | ${m.support} | ${m.detected} | ${pct(m.precision)} | ${pct(m.recall)} |`);
    }
    lines.push('');
  }

  if (benchmark.perTag.length > 0) {
    lines.push('## Per-condition (domain randomization)', '', '| condition | scenes | accuracy |', '|---|---|---|');
    for (const t of benchmark.perTag) {
      lines.push(`| ${t.tag} | ${t.scenes} | ${pct(t.accuracy)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
