import { statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerAssistantCommand } from '../../src/commands/assistant.js';
import {
  readConversationPilotCorpus,
  writePrivateJsonFile,
} from '../../src/conversation/conversation-pilot-corpus.js';
import { readCompanionRoutingProfile } from '../../src/conversation/companion-model-routing.js';

async function runAssistant(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerAssistantCommand(program);
  await program.parseAsync(['node', 'test', 'assistant', ...args]);
}

describe('buddy assistant pilot commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it('initializes the private annotated corpus from the CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-pilot-cli-'));
    const path = join(directory, 'corpus.json');
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runAssistant(['corpus-init', '--path', path]);

    expect(output.mock.calls.flat().join('\n')).toContain('Corpus pilote créé');
    expect(readConversationPilotCorpus(path).scenarios.length).toBeGreaterThanOrEqual(6);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('runs the raw-free relational contract from the CLI', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runAssistant(['relational-benchmark', '--json']);

    const serialized = String(output.mock.calls[0]?.[0] ?? '');
    const report = JSON.parse(serialized) as {
      kind: string;
      passes: boolean;
      detectionRate: number;
      results: unknown[];
    };
    expect(report).toMatchObject({
      kind: 'detector-contract-self-test',
      passes: true,
      detectionRate: 100,
    });
    expect(report.results.length).toBeGreaterThanOrEqual(6);
    expect(serialized).not.toContain('turns');
    expect(serialized).not.toContain('content');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails before provider resolution when the requested corpus is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-pilot-cli-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runAssistant([
      'compare',
      '--models',
      'first-model,second-model',
      '--corpus',
      join(directory, 'missing.json'),
    ]);

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('corpus-init');
  });

  it('activates, reports and safely rolls back the reviewed cross-surface route', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-route-cli-'));
    const preferences = join(directory, 'pilot.preferences.json');
    const aggregate = join(directory, 'pilot.aggregate.json');
    const profile = join(directory, 'routing.json');
    const events = join(directory, 'events.jsonl');
    writeRoutingEvidence(preferences, aggregate);
    vi.stubEnv('CODEBUDDY_COMPANION_ROUTING_PROFILE', profile);
    vi.stubEnv('CODEBUDDY_COMPANION_ROUTING_EVENTS', events);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runAssistant([
      'route-apply',
      '--preferences',
      preferences,
      '--aggregate',
      aggregate,
      '--ttl-days',
      '14',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(readCompanionRoutingProfile()?.winner.model).toBe('grok-pilot-alpha');
    expect(output.mock.calls.flat().join('\n')).toContain(`Fichier privé : ${profile}`);

    output.mockClear();
    await runAssistant(['route-status', '--json']);
    const status = JSON.parse(String(output.mock.calls[0]?.[0])) as {
      profile: { enabled: boolean; winner: { model: string } };
      paths: { profile: string; events: string };
      effectiveEnabled: boolean;
    };
    expect(status).toMatchObject({
      profile: { enabled: true, winner: { model: 'grok-pilot-alpha' } },
      paths: { profile, events },
      effectiveEnabled: true,
    });

    vi.stubEnv('CODEBUDDY_COMPANION_ROUTING', 'false');
    output.mockClear();
    await runAssistant(['route-status', '--json']);
    const stopped = JSON.parse(String(output.mock.calls[0]?.[0])) as {
      globallyDisabled: boolean;
      effectiveEnabled: boolean;
    };
    expect(stopped).toMatchObject({ globallyDisabled: true, effectiveEnabled: false });

    vi.stubEnv('CODEBUDDY_COMPANION_ROUTING', 'true');
    output.mockClear();
    await runAssistant(['route-disable']);
    expect(readCompanionRoutingProfile()?.enabled).toBe(false);
    expect(output.mock.calls.flat().join('\n')).toContain('désactivé immédiatement');

    output.mockClear();
    await runAssistant([
      'route-apply',
      '--preferences',
      preferences,
      '--aggregate',
      aggregate,
    ]);
    output.mockClear();
    await runAssistant(['route-rollback']);
    expect(readCompanionRoutingProfile()?.enabled).toBe(false);
    expect(output.mock.calls.flat().join('\n')).toContain('désactivé');
  });

  it('rejects malformed activation thresholds instead of silently changing them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-route-cli-'));
    const preferences = join(directory, 'pilot.preferences.json');
    const aggregate = join(directory, 'pilot.aggregate.json');
    const profile = join(directory, 'routing.json');
    writeRoutingEvidence(preferences, aggregate);
    vi.stubEnv('CODEBUDDY_COMPANION_ROUTING_PROFILE', profile);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runAssistant([
      'route-apply',
      '--preferences',
      preferences,
      '--aggregate',
      aggregate,
      '--min-coverage',
      'not-a-ratio',
    ]);

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('--min-coverage');
    expect(readCompanionRoutingProfile()).toBeNull();
  });
});

function writeRoutingEvidence(preferencesPath: string, aggregatePath: string): void {
  writePrivateJsonFile(preferencesPath, {
    version: 2,
    kind: 'lisa-blind-preferences',
    comparisonId: 'cli-safe-comparison',
    revealedAt: '2026-07-13T12:00:00.000Z',
    judgedTrials: 3,
    totalTrials: 4,
    reviewedSafetyCoverage: {
      categoryTrials: { relationship_safety: 1, philosophy: 2 },
      relationshipSafetyTrials: 1,
      highRiskTrials: 1,
      highRiskRelationshipSafetyTrials: 1,
    },
    recommendedCandidateId: 'candidate-alpha',
    candidates: [
      {
        candidateId: 'candidate-alpha',
        model: 'grok-pilot-alpha',
        provider: 'grok-oauth',
        appearances: 3,
        wins: 3,
        bordaPoints: 6,
        averageBorda: 2,
        winRate: 1,
      },
      {
        candidateId: 'candidate-beta',
        model: 'qwen-pilot-beta',
        provider: 'ollama',
        appearances: 3,
        wins: 0,
        bordaPoints: 3,
        averageBorda: 1,
        winRate: 0,
      },
    ],
  });
  writePrivateJsonFile(aggregatePath, {
    version: 2,
    kind: 'lisa-blind-comparison-aggregate',
    comparisonId: 'cli-safe-comparison',
    generatedAt: '2026-07-13T11:00:00.000Z',
    corpusFingerprint: 'private-corpus',
    scenarioCount: 4,
    trialsPerCandidate: 4,
    safetyCoverage: {
      categoryTrials: { relationship_safety: 1, philosophy: 3 },
      relationshipSafetyTrials: 1,
      highRiskTrials: 1,
      highRiskRelationshipSafetyTrials: 1,
    },
    recommendedCandidateId: 'candidate-alpha',
    candidates: [
      aggregateCandidate('candidate-alpha', 'grok-pilot-alpha', 'grok-oauth', 0.94),
      aggregateCandidate('candidate-beta', 'qwen-pilot-beta', 'ollama', 0.82),
    ],
  });
}

function aggregateCandidate(
  candidateId: string,
  model: string,
  provider: string,
  averageScore: number
): Record<string, unknown> {
  return {
    candidateId,
    model,
    provider,
    runs: 4,
    errors: 0,
    passed: 4,
    passRate: 1,
    safetyPassRate: 1,
    averageScore,
    averageLatencyMs: 1_000,
    totalInputTokens: 400,
    totalOutputTokens: 160,
    totalCostUsd: 0,
    averageCostUsd: 0,
    automatedUtility: averageScore,
  };
}
