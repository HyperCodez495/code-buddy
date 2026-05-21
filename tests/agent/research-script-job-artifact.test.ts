import { describe, expect, it } from 'vitest';
import {
  RESEARCH_SCRIPT_JOB_SCHEMA_VERSION,
  buildResearchScriptJobArtifact,
  renderResearchScriptJobManifest,
  renderResearchScriptJobReadme,
} from '../../src/agent/research-script-job-artifact.js';

describe('research script job artifact', () => {
  it('builds a first-class script job envelope with paths, command, policy, and assertions', () => {
    const job = buildResearchScriptJobArtifact({
      goal: 'Find public contact details from architect profile pages',
      title: 'Architect enrichment',
      language: 'python',
      createdAt: '2026-05-18T16:30:00.000Z',
      scriptFileName: '../enrich leads.py',
      inputContract: {
        LEADS_JSON: 'Input lead records.',
        OUTPUT_JSON: 'Output enriched lead records.',
      },
      outputContract: {
        enriched: 'Enriched rows with evidence.',
      },
      sandboxPolicy: {
        provider: 'local',
        network: 'https_only_public_web',
        writes: 'output_path_only',
        allowedDomains: ['atelier.example', 'atelier.example'],
        ignoredDomains: ['annuaire.example'],
        pageBudget: 5,
        delayMs: 750,
        stopOn: ['captcha', '429'],
      },
    });

    expect(job).toMatchObject({
      schemaVersion: RESEARCH_SCRIPT_JOB_SCHEMA_VERSION,
      id: expect.stringMatching(/^research-script-/),
      title: 'Architect enrichment',
      language: 'python',
      files: {
        manifest: expect.stringMatching(/^research-scripts\/research-script-.+\/manifest\.json$/),
        script: expect.stringContaining('enrich-leads.py'),
        input: expect.stringContaining('input.json'),
        output: expect.stringContaining('output.json'),
        stdout: expect.stringContaining('stdout.log'),
        stderr: expect.stringContaining('stderr.log'),
      },
      command: {
        executable: 'python',
        args: [expect.stringContaining('enrich-leads.py')],
        cwd: '.',
        env: {
          INPUT_JSON: expect.stringContaining('input.json'),
          OUTPUT_JSON: expect.stringContaining('output.json'),
        },
      },
      sandboxPolicy: {
        provider: 'local',
        network: 'https_only_public_web',
        writes: 'output_path_only',
        allowedDomains: ['atelier.example'],
        ignoredDomains: ['annuaire.example'],
        pageBudget: 5,
        delayMs: 750,
        stopOn: ['captcha', '429'],
      },
      agentRunArtifact: {
        kind: 'script',
        title: 'Architect enrichment',
      },
    });
    expect(job.agentRunArtifact.path).toBe(job.files.manifest);
    expect(job.assertions.map((assertion) => assertion.id)).toEqual([
      'output-json-written',
      'evidence-preserved',
      'no-contact-action',
    ]);
  });

  it('renders manifest JSON and a human-readable README for review before execution', () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-demo',
      goal: 'Review public data script',
      title: 'Reviewable job',
      language: 'typescript',
      inputContract: { INPUT_JSON: 'Input records.' },
      outputContract: { OUTPUT_JSON: 'Output records.' },
    });

    const manifest = JSON.parse(renderResearchScriptJobManifest(job)) as typeof job;
    expect(manifest.id).toBe('research-script-demo');
    expect(manifest.files.script).toBe('research-scripts/research-script-demo/script.ts');

    const readme = renderResearchScriptJobReadme(job);
    expect(readme).toContain('# Reviewable job');
    expect(readme).toContain('Network: https_only_public_web');
    expect(readme).toContain('- tsx research-scripts/research-script-demo/script.ts');
    expect(readme).toContain('The script does not send email');
  });
});
