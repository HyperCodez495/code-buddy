import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');

describe('ChatView goal mode UI', () => {
  it('exposes a composer control that launches /goal through the Cowork command bridge', () => {
    const source = fs.readFileSync(chatViewPath, 'utf8');

    expect(source).toContain("data-testid=\"chat-goal-mode-toggle\"");
    expect(source).toContain('aria-pressed={goalComposerActive}');
    expect(source).toContain("window.electronAPI.command.execute(\n          'goal'");
    expect(source).toContain("commandName: 'goal'");
    expect(source).toContain('setGoalComposerActive(false)');
    expect(source).toContain("t('goalMode.composerLabel', 'Goal')");
  });
});
