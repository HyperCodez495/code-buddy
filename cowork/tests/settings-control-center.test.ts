import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const controlCenterPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsControlCenter.tsx'
);
const localePaths = ['en', 'fr', 'zh'].map((locale) =>
  path.resolve(process.cwd(), `src/renderer/i18n/locales/${locale}.json`)
);

const requiredControlKeys = [
  'tabLabel',
  'tabHint',
  'title',
  'description',
  'actionConfigure',
  'actionOpen',
  'quickModel',
  'quickSafety',
  'quickHarness',
  'runtimeTitle',
  'guardrailsTitle',
  'automationTitle',
  'testRunnerDesc',
  'agentsTitle',
  'observabilityTitle',
] as const;

describe('Settings control center', () => {
  it('makes the control center the default settings landing tab', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain("initialTab = 'control'");
    expect(source).toContain("id: 'control' as TabId");
    expect(source).toContain('<SettingsControlCenter');
    expect(source).toContain("setShowTestRunner(true)");
    expect(source).toContain("setShowFleetCommandCenter(true)");
  });

  it('exposes direct controls for the harness and major Code Buddy surfaces', () => {
    const source = fs.readFileSync(controlCenterPath, 'utf8');
    expect(source).toContain("data-testid=\"control-center-quick-actions\"");
    expect(source).toContain("data-testid=\"control-center-quick-harness\"");
    expect(source).toContain("'controlCenter.automationTitle'");
    expect(source).toContain("'controlCenter.testRunnerDesc'");
    expect(source).toContain('onOpenTestRunner');
    expect(source).toContain('onOpenOrchestrator');
    expect(source).toContain('onOpenFleet');
    expect(source).toContain('onOpenTeam');
    expect(source).toContain('onOpenCompanion');
  });

  it('ships localized control-center copy for all supported locales', () => {
    for (const localePath of localePaths) {
      const locale = JSON.parse(fs.readFileSync(localePath, 'utf8')) as {
        controlCenter: Record<string, string>;
      };
      for (const key of requiredControlKeys) {
        expect(locale.controlCenter[key], `${path.basename(localePath)}:${key}`).toBeTruthy();
      }
    }

    const fr = JSON.parse(fs.readFileSync(localePaths[1] ?? '', 'utf8')) as {
      controlCenter: Record<string, string>;
    };
    expect(fr.controlCenter.tabLabel).toContain('Centre');
    expect(fr.controlCenter.quickHarness).toContain('Harnais');
  });
});
