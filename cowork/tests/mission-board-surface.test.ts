import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const shellNavigationPath = path.resolve(process.cwd(), 'src/renderer/components/ShellNavigation.tsx');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');
const panelPath = path.resolve(process.cwd(), 'src/renderer/components/MissionBoardPanel.tsx');

describe('mission board surface', () => {
  it('wires the mission board overlay into App and the global store', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const storeSource = fs.readFileSync(storePath, 'utf8');

    expect(appSource).toContain('import { MissionBoardPanel }');
    expect(appSource).toContain('<MissionBoardWrapper />');
    expect(appSource).toContain('showMissionBoard');
    expect(appSource).toContain('setShowMissionBoard');
    expect(storeSource).toContain('showMissionBoard: boolean');
    expect(storeSource).toContain('showMissionBoard: false');
    expect(storeSource).toContain('setShowMissionBoard: (show) => set({ showMissionBoard: show })');
  });

  it('adds a shell navigation entry for the autonomous mission board', () => {
    const source = fs.readFileSync(shellNavigationPath, 'utf8');

    expect(source).toContain("label: t('missionBoard.title', 'Mission Board')");
    expect(source).toContain('active: showMissionBoard');
    expect(source).toContain('onClick: () => setShowMissionBoard(true)');
    expect(source).toContain("testId: 'mission-board-button'");
  });

  it('keeps mission execution preview-only from the board surface', () => {
    const source = fs.readFileSync(panelPath, 'utf8');

    expect(source).toContain('data-testid="mission-board-panel"');
    expect(source).toContain('api.runNextMission({ dryRun: true })');
    expect(source).toContain('data-testid="mission-board-prepare-next"');
  });
});
