/**
 * Human-readable benchmark report for a vision-training run. Pure string
 * rendering — the engine writes this to .codebuddy/vision-train/.
 */
import type { Benchmark } from './scorer.js';
import type { AuditResult } from './engine.js';

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

/** Detection-only audit report (no ground truth). */
export function renderAudit(audit: AuditResult, meta: { source: string; model?: string }): string {
  const lines: string[] = [];
  lines.push('# Vision perception audit (detection-only)', '');
  lines.push(`- Images perceived: **${audit.images.length}**`);
  lines.push(`- Image source: ${meta.source}`);
  if (meta.model) lines.push(`- Perception model: ${meta.model}`);
  lines.push('');

  const totals = Object.entries(audit.totals).sort((a, b) => b[1] - a[1]);
  if (totals.length > 0) {
    lines.push('## Detected across all images', '', '| label | total |', '|---|---|');
    for (const [label, n] of totals) lines.push(`| ${label} | ${n} |`);
    lines.push('');
  } else {
    lines.push('_No objects detected._', '');
  }

  lines.push('## Per image', '', '| image | detections |', '|---|---|');
  for (const img of audit.images) {
    const detail =
      Object.entries(img.counts)
        .sort((a, b) => b[1] - a[1])
        .map(([l, n]) => `${l}×${n}`)
        .join(', ') || '—';
    lines.push(`| ${img.id} | ${detail} |`);
  }
  lines.push('');

  if (audit.failures.length > 0) {
    lines.push(`_${audit.failures.length} image(s) failed perception._`, '');
  }

  return lines.join('\n');
}
