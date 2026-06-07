import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const shellNavigationPath = path.resolve(process.cwd(), 'src/renderer/components/ShellNavigation.tsx');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');
const panelPath = path.resolve(process.cwd(), 'src/renderer/components/DesktopSnapshotPanel.tsx');
const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const chatComposerEventsPath = path.resolve(process.cwd(), 'src/renderer/utils/chat-composer-events.ts');
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
const mainPath = path.resolve(process.cwd(), 'src/main/index.ts');
const ipcPath = path.resolve(process.cwd(), 'src/main/ipc/desktop-snapshot-ipc.ts');

describe('desktop snapshot surface', () => {
  it('wires the passive desktop snapshot overlay into App and the global store', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const storeSource = fs.readFileSync(storePath, 'utf8');

    expect(appSource).toContain('import { DesktopSnapshotPanel }');
    expect(appSource).toContain('<DesktopSnapshotWrapper />');
    expect(appSource).toContain('showDesktopSnapshot');
    expect(appSource).toContain('setShowDesktopSnapshot');
    expect(storeSource).toContain('showDesktopSnapshot: boolean');
    expect(storeSource).toContain('showDesktopSnapshot: false');
    expect(storeSource).toContain('setShowDesktopSnapshot: (show) => set({ showDesktopSnapshot: show })');
  });

  it('adds a shell navigation entry for desktop GUI inspection', () => {
    const source = fs.readFileSync(shellNavigationPath, 'utf8');

    expect(source).toContain("label: t('desktopSnapshot.title', 'Desktop Snapshot')");
    expect(source).toContain('active: showDesktopSnapshot');
    expect(source).toContain('onClick: () => setShowDesktopSnapshot(true)');
    expect(source).toContain("testId: 'desktop-snapshot-button'");
  });

  it('exposes desktopSnapshot through main and preload without GUI mutation actions', () => {
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const preloadSource = fs.readFileSync(preloadPath, 'utf8');
    const ipcSource = fs.readFileSync(ipcPath, 'utf8');
    const panelSource = fs.readFileSync(panelPath, 'utf8');

    expect(mainSource).toContain('registerDesktopSnapshotIpcHandlers');
    expect(preloadSource).toContain('desktopSnapshot: {');
    expect(preloadSource).toContain("ipcRenderer.invoke('desktopSnapshot.capture'");
    expect(ipcSource).toContain("loadCoreModule<DesktopAutomationCoreMod>('desktop-automation/index.js')");
    expect(ipcSource).toContain("ipcMain.handle('desktopSnapshot.capture'");
    expect(panelSource).toContain('data-testid="desktop-snapshot-panel"');
    expect(panelSource).not.toContain('guiControl(');
    expect(panelSource).not.toContain('desktopSnapshot.click');
  });

  it('routes snapshot context into the chat composer through a passive event', () => {
    const panelSource = fs.readFileSync(panelPath, 'utf8');
    const chatSource = fs.readFileSync(chatViewPath, 'utf8');
    const eventsSource = fs.readFileSync(chatComposerEventsPath, 'utf8');

    expect(eventsSource).toContain("CHAT_COMPOSER_INSERT_EVENT = 'chat:composer-insert'");
    expect(panelSource).toContain('buildDesktopSnapshotActionPrompt');
    expect(panelSource).toContain('dispatchChatComposerInsert(prompt)');
    expect(panelSource).toContain('data-testid="desktop-snapshot-prepare-action"');
    expect(chatSource).toContain('CHAT_COMPOSER_INSERT_EVENT');
    expect(chatSource).toContain('ChatComposerInsertDetail');
    expect(chatSource).toContain('window.addEventListener(CHAT_COMPOSER_INSERT_EVENT');
    expect(chatSource).not.toContain('desktopSnapshot.click');
  });
});
