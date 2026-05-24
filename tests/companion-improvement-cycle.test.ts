import {
  formatCompanionImprovementCycle,
  runCompanionImprovementCycle,
} from '../src/companion/improvement-cycle.js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildCompanionCompetitiveRadar: vi.fn(),
  readCompanionMissionBoard: vi.fn(),
  syncCompanionMissionBoard: vi.fn(),
  runNextCompanionMission: vi.fn(),
  recordCompanionPercept: vi.fn(),
  recordCompanionSafetyEvent: vi.fn(),
}));

jest.mock('../src/companion/competitive-radar.js', () => ({
  buildCompanionCompetitiveRadar: mocks.buildCompanionCompetitiveRadar,
}));

jest.mock('../src/companion/mission-board.js', () => ({
  readCompanionMissionBoard: mocks.readCompanionMissionBoard,
  syncCompanionMissionBoard: mocks.syncCompanionMissionBoard,
}));

jest.mock('../src/companion/mission-runner.js', () => ({
  runNextCompanionMission: mocks.runNextCompanionMission,
}));

jest.mock('../src/companion/percepts.js', () => ({
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

jest.mock('../src/companion/safety-ledger.js', () => ({
  recordCompanionSafetyEvent: mocks.recordCompanionSafetyEvent,
}));

function mission() {
  return {
    id: 'mission-companion-voice-barge-in',
    title: 'multimodal: add voice barge-in',
    dimension: 'multimodal',
    status: 'open',
    priority: 'P0',
    summary: 'Buddy needs full-duplex voice flow.',
    recommendation: 'Add barge-in state and tests.',
    sourceGapId: 'companion-voice-barge-in',
    sourceRadarId: 'radar-1',
    competitorRefs: ['uni', 'lisa'],
    tags: ['voice', 'barge-in'],
    createdAt: '2026-05-24T10:00:00.000Z',
    updatedAt: '2026-05-24T10:00:00.000Z',
  };
}

function board(missions = [mission()]) {
  return {
    schemaVersion: 1,
    cwd: '/repo',
    storePath: '/repo/.codebuddy/companion/missions.json',
    updatedAt: '2026-05-24T10:00:00.000Z',
    missions,
  };
}

function radar() {
  return {
    id: 'radar-1',
    timestamp: '2026-05-24T10:00:00.000Z',
    cwd: '/repo',
    score: 72,
    comparedAgainst: [],
    currentStrengths: ['Companion cockpit exists.'],
    gaps: [
      {
        id: 'companion-voice-barge-in',
        dimension: 'multimodal',
        severity: 'gap',
        summary: 'Voice needs interruption.',
        recommendation: 'Add barge-in state and tests.',
        competitorRefs: ['uni', 'lisa'],
        tags: ['voice', 'barge-in'],
      },
    ],
    nextMoves: ['Add barge-in state and tests.'],
    sourceNotes: [],
    selfEvaluation: {
      score: 80,
      level: 'aware',
      findings: [],
      nextActions: [],
    },
  };
}

describe('companion improvement cycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocks.buildCompanionCompetitiveRadar.mockResolvedValue(radar());
    mocks.readCompanionMissionBoard.mockResolvedValue(board());
    mocks.syncCompanionMissionBoard.mockResolvedValue({
      board: board(),
      radarId: 'radar-1',
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    mocks.runNextCompanionMission.mockResolvedValue({
      success: true,
      dryRun: false,
      message: 'Prepared mission.',
      mission: mission(),
      board: board(),
      briefPath: '/repo/.codebuddy/companion/mission-runs/mission.md',
    });
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'percept-1' });
    mocks.recordCompanionSafetyEvent.mockResolvedValue({ id: 'safety-1' });
  });

  it('syncs missions, prepares the next brief, and records the cycle', async () => {
    const now = new Date('2026-05-24T10:00:00.000Z');

    const cycle = await runCompanionImprovementCycle({ cwd: '/repo', now });

    expect(cycle.id).toBe('companion-improve-20260524100000000');
    expect(cycle.recorded).toBe(true);
    expect(cycle.missionSync?.created).toBe(1);
    expect(cycle.missionRun?.mission?.id).toBe('mission-companion-voice-barge-in');
    expect(cycle.nextActions[0]).toContain('/repo/.codebuddy/companion/mission-runs/mission.md');
    expect(cycle.perceptId).toBe('percept-1');
    expect(cycle.safetyEventId).toBe('safety-1');
    expect(mocks.buildCompanionCompetitiveRadar).toHaveBeenCalledWith({
      cwd: '/repo',
      now,
      recordSuggestions: true,
    });
    expect(mocks.syncCompanionMissionBoard).toHaveBeenCalledWith({
      cwd: '/repo',
      now,
      recordSuggestions: true,
    });
    expect(mocks.runNextCompanionMission).toHaveBeenCalledWith({
      cwd: '/repo',
      now,
      dryRun: false,
    });
    expect(mocks.recordCompanionPercept).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'suggestion',
        source: 'companion_improvement_cycle',
      }),
      { cwd: '/repo' },
    );

    const formatted = formatCompanionImprovementCycle(cycle);
    expect(formatted).toContain('Buddy Companion Improvement Cycle');
    expect(formatted).toContain('Mission sync: 1 created, 0 updated, 0 unchanged');
    expect(formatted).toContain('Selected mission:');
  });

  it('dry-runs without writing mission sync, percepts, or safety events', async () => {
    const now = new Date('2026-05-24T10:00:00.000Z');

    const cycle = await runCompanionImprovementCycle({
      cwd: '/repo',
      now,
      dryRun: true,
    });

    expect(cycle.dryRun).toBe(true);
    expect(cycle.recorded).toBe(false);
    expect(cycle.missionSync).toBeUndefined();
    expect(mocks.buildCompanionCompetitiveRadar).toHaveBeenCalledWith({
      cwd: '/repo',
      now,
      recordSuggestions: false,
    });
    expect(mocks.readCompanionMissionBoard).toHaveBeenCalledWith({ cwd: '/repo', now });
    expect(mocks.syncCompanionMissionBoard).not.toHaveBeenCalled();
    expect(mocks.runNextCompanionMission).toHaveBeenCalledWith({
      cwd: '/repo',
      now,
      dryRun: true,
    });
    expect(mocks.recordCompanionPercept).not.toHaveBeenCalled();
    expect(mocks.recordCompanionSafetyEvent).not.toHaveBeenCalled();
    expect(formatCompanionImprovementCycle(cycle)).toContain('Mission sync: skipped for dry-run');
  });
});
