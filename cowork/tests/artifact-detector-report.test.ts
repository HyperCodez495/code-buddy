import { describe, expect, it } from 'vitest';

import { detectArtifacts, detectReport } from '../src/renderer/utils/artifact-detector';

const REPORT = [
  '# Panorama des LLM open-source en 2026',
  '',
  'Les modèles open-source ont beaucoup progressé [1]. La performance rivalise',
  'désormais avec le propriétaire [2], notamment sur le raisonnement [3].',
  '',
  '## Analyse',
  '',
  "Le coût d'inférence a chuté de moitié [1].",
  '',
  '## Références',
  '',
  "[1] Rapport État de l'IA 2026 — https://example.com/ai-2026",
  '[2] Benchmark ouvert — https://example.org/bench',
  '[3] paper-llm.pdf (p.2, Methods)',
].join('\n');

describe('detectReport', () => {
  it('recognizes a cited research report and parses title/body/sources', () => {
    const report = detectReport(REPORT);
    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.title).toBe('Panorama des LLM open-source en 2026');
    // Body keeps the analysis section but stops before the references heading.
    expect(report.body).toContain('## Analyse');
    expect(report.body).not.toContain('## Références');
    expect(report.body).not.toContain('example.com');

    expect(report.sources).toHaveLength(3);
    expect(report.sources[0]).toEqual({
      n: 1,
      label: "Rapport État de l'IA 2026",
      url: 'https://example.com/ai-2026',
    });
    expect(report.sources[1]).toEqual({
      n: 2,
      label: 'Benchmark ouvert',
      url: 'https://example.org/bench',
    });
  });

  it('parses a PaperQA-style reference into page/section', () => {
    const report = detectReport(REPORT);
    expect(report?.sources[2]).toEqual({
      n: 3,
      label: 'paper-llm.pdf',
      page: '2',
      section: 'Methods',
    });
  });

  it('accepts a References / Sources heading (case + language tolerant)', () => {
    const en = REPORT.replace('## Références', '## References');
    expect(detectReport(en)?.sources).toHaveLength(3);
    const sources = REPORT.replace('## Références', '## Sources');
    expect(detectReport(sources)?.sources).toHaveLength(3);
  });

  it('is not a report without a references heading', () => {
    const plain = 'Voici un point rapide [1] et un autre [2], mais aucune bibliographie.';
    expect(detectReport(plain)).toBeNull();
  });

  it('is not a report when there are fewer than two inline citations', () => {
    const thin = ['Une seule citation [1].', '', '## Références', '', '[1] Source — https://x.io'].join(
      '\n'
    );
    expect(detectReport(thin)).toBeNull();
  });

  it('surfaces a report artifact through detectArtifacts, as the first chip', () => {
    const artifacts = detectArtifacts(REPORT);
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    const first = artifacts[0];
    expect(first?.kind).toBe('report');
    expect(first?.report?.sources).toHaveLength(3);
    // raw markdown is preserved for the Source tab
    expect(first?.source).toContain('## Références');
  });

  it('tolerates a malformed reference line (still yields a label)', () => {
    const md = [
      'Alpha [1]. Beta [2].',
      '',
      '## Références',
      '',
      '[1] just a bare label with no url or page',
      '[2] Titre — https://ok.example',
    ].join('\n');
    const report = detectReport(md);
    expect(report?.sources[0]).toEqual({ n: 1, label: 'just a bare label with no url or page' });
    expect(report?.sources[1]?.url).toBe('https://ok.example');
  });
});
