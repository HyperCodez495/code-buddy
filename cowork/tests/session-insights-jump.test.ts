import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sessionInsightsPath = path.resolve(
  process.cwd(),
  'src/renderer/components/SessionInsightsPanel.tsx'
);
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');

describe('Session insights jump to message', () => {
  it('sets a focused message target when opening a session message from insights', () => {
    const source = fs.readFileSync(sessionInsightsPath, 'utf8');
    expect(source).toContain('setFocusedMessageTarget');
    expect(source).toContain('openSessionAtMessage');
    expect(source).toContain("title={t('sessionInsights.jumpToMessage'");
  });

  it('exposes transcript audit controls in SessionInsightsPanel', () => {
    const source = fs.readFileSync(sessionInsightsPath, 'utf8');
    expect(source).toContain('loadAudit');
    expect(source).toContain("t('sessionInsights.auditTranscript'");
    expect(source).toContain("t('sessionInsights.auditTitle'");
    expect(source).toContain("t('sessionInsights.repairTranscript'");
    expect(source).toContain("t('sessionInsights.auditPendingJournalTurns'");
    expect(source).toContain("t('sessionInsights.auditMissingJournalUserMessages'");
    expect(source).toContain("t('sessionInsights.auditUnrecoverableJournalSubmissions'");
    expect(source).toContain("t('sessionInsights.auditMalformedJournalEvents'");
  });

  it('exposes the turn journal section in SessionInsightsPanel', () => {
    const source = fs.readFileSync(sessionInsightsPath, 'utf8');
    expect(source).toContain('session-insights-turn-journal');
    expect(source).toContain("t('sessionInsights.turnJournal'");
    expect(source).toContain('detail.turnJournal.events');
  });

  it('exposes memory preview accept/reject controls in SessionInsightsPanel', () => {
    const source = fs.readFileSync(sessionInsightsPath, 'utf8');
    expect(source).toContain("t('sessionInsights.memoryPreview'");
    expect(source).toContain('acceptMemoryCandidate');
    expect(source).toContain('rejectMemoryCandidate');
    expect(source).toContain("window.electronAPI?.memory?.add");
    expect(source).toContain("t('common.accept'");
    expect(source).toContain("t('common.reject'");
    expect(source).toContain('visibleMemoryCandidates');
  });

  it('exposes session recall prefill diagnostics through preload', () => {
    const source = fs.readFileSync(preloadPath, 'utf8');
    expect(source).toContain('recallPrefill');
    expect(source).toContain('sessionInsights.recallPrefill');
  });

  it('ChatView scrolls to a focused message target after switching sessions', () => {
    const source = fs.readFileSync(chatViewPath, 'utf8');
    expect(source).toContain('focusedMessageTarget');
    expect(source).toContain('clearFocusedMessageTarget');
    expect(source).toContain('element.scrollIntoView({ behavior: \'smooth\', block: \'center\' })');
  });
});
