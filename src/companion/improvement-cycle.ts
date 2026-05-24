import {
  buildCompanionCompetitiveRadar,
  type CompanionCompetitiveRadar,
} from './competitive-radar.js';
import {
  readCompanionMissionBoard,
  syncCompanionMissionBoard,
  type CompanionMissionBoard,
  type CompanionMissionBoardSyncResult,
} from './mission-board.js';
import {
  runNextCompanionMission,
  type CompanionMissionRunResult,
} from './mission-runner.js';
import { recordCompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';

export interface CompanionImprovementCycleOptions {
  cwd?: string;
  now?: Date;
  dryRun?: boolean;
  recordSuggestions?: boolean;
  runMission?: boolean;
}

export interface CompanionImprovementCycle {
  id: string;
  timestamp: string;
  cwd: string;
  dryRun: boolean;
  recorded: boolean;
  radar: CompanionCompetitiveRadar;
  board: CompanionMissionBoard;
  missionSync?: CompanionMissionBoardSyncResult;
  missionRun?: CompanionMissionRunResult;
  nextActions: string[];
  perceptId?: string;
  safetyEventId?: string;
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function cycleId(now: Date): string {
  return `companion-improve-${now.toISOString().replace(/[-:.TZ]/g, '')}`;
}

function topGapCount(radar: CompanionCompetitiveRadar): number {
  return radar.gaps.filter(gap => gap.severity === 'gap').length;
}

function buildNextActions(cycle: CompanionImprovementCycle): string[] {
  const actions: string[] = [];
  const mission = cycle.missionRun?.mission;
  if (mission) {
    actions.push(cycle.missionRun?.briefPath
      ? `Implement the prepared mission brief: ${cycle.missionRun.briefPath}`
      : `Review the selected mission: ${mission.id}`);
  }

  if (!mission && cycle.dryRun) {
    actions.push('Run `buddy companion improve` to sync missions and prepare the next improvement brief.');
  }

  if (!mission && !cycle.dryRun) {
    actions.push('No open mission was selected; rerun the competitive radar after new companion evidence exists.');
  }

  actions.push(...cycle.radar.nextMoves.slice(0, 3));
  return [...new Set(actions)].slice(0, 6);
}

async function recordCycle(cycle: CompanionImprovementCycle): Promise<{
  perceptId?: string;
  safetyEventId?: string;
}> {
  let perceptId: string | undefined;
  let safetyEventId: string | undefined;

  try {
    const percept = await recordCompanionPercept({
      modality: 'suggestion',
      source: 'companion_improvement_cycle',
      summary: cycle.missionRun?.mission
        ? `Companion improvement cycle prepared ${cycle.missionRun.mission.id}.`
        : `Companion improvement cycle found ${topGapCount(cycle.radar)} gap(s).`,
      confidence: 0.92,
      payload: {
        cycleId: cycle.id,
        radarId: cycle.radar.id,
        radarScore: cycle.radar.score,
        missionCount: cycle.board.missions.length,
        missionId: cycle.missionRun?.mission?.id,
        briefPath: cycle.missionRun?.briefPath,
        created: cycle.missionSync?.created,
        updated: cycle.missionSync?.updated,
        unchanged: cycle.missionSync?.unchanged,
        nextActions: cycle.nextActions,
      },
      tags: ['improvement-cycle', 'self-improvement', 'mission-board'],
    }, { cwd: cycle.cwd });
    perceptId = percept.id;
  } catch {
    // The cycle result is still useful if percept logging is temporarily unavailable.
  }

  try {
    const event = await recordCompanionSafetyEvent({
      kind: 'mission',
      risk: 'low',
      action: 'companion_improvement_cycle',
      reason: 'Ran a workspace-local self-improvement cycle for Buddy companion.',
      status: 'completed',
      source: 'companion_improvement_cycle',
      artifactPath: cycle.missionRun?.briefPath,
      missionId: cycle.missionRun?.mission?.id,
      payload: {
        cycleId: cycle.id,
        radarId: cycle.radar.id,
        dryRun: cycle.dryRun,
        missionCount: cycle.board.missions.length,
      },
      tags: ['improvement-cycle', 'self-improvement', 'mission-board'],
    }, { cwd: cycle.cwd, now: new Date(cycle.timestamp) });
    safetyEventId = event.id;
  } catch {
    // Keep the improvement cycle non-blocking when the safety ledger is locked.
  }

  return { perceptId, safetyEventId };
}

export async function runCompanionImprovementCycle(
  options: CompanionImprovementCycleOptions = {},
): Promise<CompanionImprovementCycle> {
  const now = options.now || new Date();
  const cwd = resolveCwd(options.cwd);
  const dryRun = Boolean(options.dryRun);
  const recorded = !dryRun && options.recordSuggestions !== false;
  const radar = await buildCompanionCompetitiveRadar({
    cwd,
    now,
    recordSuggestions: recorded,
  });

  let board: CompanionMissionBoard;
  let missionSync: CompanionMissionBoardSyncResult | undefined;
  if (dryRun) {
    board = await readCompanionMissionBoard({ cwd, now });
  } else {
    missionSync = await syncCompanionMissionBoard({
      cwd,
      now,
      recordSuggestions: recorded,
    });
    board = missionSync.board;
  }

  const missionRun = options.runMission === false
    ? undefined
    : await runNextCompanionMission({ cwd, now, dryRun });

  const cycle: CompanionImprovementCycle = {
    id: cycleId(now),
    timestamp: now.toISOString(),
    cwd: radar.cwd,
    dryRun,
    recorded,
    radar,
    board,
    missionSync,
    missionRun,
    nextActions: [],
  };
  cycle.nextActions = buildNextActions(cycle);

  if (recorded) {
    const recordedIds = await recordCycle(cycle);
    cycle.perceptId = recordedIds.perceptId;
    cycle.safetyEventId = recordedIds.safetyEventId;
  }

  return cycle;
}

export function formatCompanionImprovementCycle(cycle: CompanionImprovementCycle): string {
  const lines = [
    'Buddy Companion Improvement Cycle',
    '='.repeat(50),
    '',
    `Workspace: ${cycle.cwd}`,
    `Cycle: ${cycle.id}`,
    `Mode: ${cycle.dryRun ? 'dry-run' : 'recorded'}`,
    `Competitive score: ${cycle.radar.score}/100`,
    `Self-evaluation: ${cycle.radar.selfEvaluation.score}/100 (${cycle.radar.selfEvaluation.level})`,
    `Priority gaps: ${topGapCount(cycle.radar)}`,
    `Missions: ${cycle.board.missions.length}`,
  ];

  if (cycle.missionSync) {
    lines.push(`Mission sync: ${cycle.missionSync.created} created, ${cycle.missionSync.updated} updated, ${cycle.missionSync.unchanged} unchanged`);
  } else if (cycle.dryRun) {
    lines.push('Mission sync: skipped for dry-run');
  }

  if (cycle.missionRun?.mission) {
    lines.push('', 'Selected mission:');
    lines.push(`- [${cycle.missionRun.mission.priority}] ${cycle.missionRun.mission.id}`);
    lines.push(`  ${cycle.missionRun.mission.title}`);
    lines.push(`  ${cycle.missionRun.mission.recommendation}`);
    if (cycle.missionRun.briefPath) lines.push(`  Brief: ${cycle.missionRun.briefPath}`);
  } else if (cycle.missionRun) {
    lines.push('', `Mission runner: ${cycle.missionRun.message}`);
  }

  if (cycle.nextActions.length > 0) {
    lines.push('', 'Next actions:', ...cycle.nextActions.map(action => `- ${action}`));
  }

  if (cycle.perceptId || cycle.safetyEventId) {
    lines.push('', 'Recorded:');
    if (cycle.perceptId) lines.push(`- Percept: ${cycle.perceptId}`);
    if (cycle.safetyEventId) lines.push(`- Safety event: ${cycle.safetyEventId}`);
  }

  return lines.join('\n');
}
