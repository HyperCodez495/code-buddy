import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const configModalPath = path.resolve(process.cwd(), 'src/renderer/components/ConfigModal.tsx');
const llmConfigPanelPath = path.resolve(process.cwd(), 'src/renderer/components/LLMConfigPanel.tsx');
// SettingsPanel was split — API settings (including provider guidance) live in settings/SettingsAPI.tsx
const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsApiPath = path.resolve(process.cwd(), 'src/renderer/components/settings/SettingsAPI.tsx');
const settingsDir = path.resolve(process.cwd(), 'src/renderer/components/settings');
const settingsPanelContent = [
  fs.readFileSync(settingsPanelPath, 'utf8'),
  fs.readFileSync(llmConfigPanelPath, 'utf8'),
  ...fs.readdirSync(settingsDir).map((f) => fs.readFileSync(path.join(settingsDir, f), 'utf8')),
].join('\n');
const settingsApiSource = fs.readFileSync(settingsApiPath, 'utf8');

describe('provider guidance UI wiring', () => {
  it('wires shared guidance UI into ConfigModal', () => {
    const source = fs.readFileSync(configModalPath, 'utf8');
    const panelSource = fs.readFileSync(llmConfigPanelPath, 'utf8');
    expect(source).toContain('LLMConfigPanel');
    expect(panelSource).toContain('CommonProviderSetupsCard');
    expect(panelSource).toContain('GuidanceInlineHint');
    expect(panelSource).toContain('onApplySetup={controller.applyCommonProviderSetup}');
    expect(source).toContain('friendlyTestDetails={apiConfig.friendlyTestDetails}');
  });

  it('wires shared guidance UI into SettingsPanel', () => {
    expect(settingsPanelContent).toContain('CommonProviderSetupsCard');
    expect(settingsPanelContent).toContain('GuidanceInlineHint');
    expect(settingsPanelContent).toContain('onApplySetup={controller.applyCommonProviderSetup}');
    expect(settingsPanelContent).toContain('<ApiDiagnosticsPanel');
  });

  it('keeps the primary LLM actions discoverable and avoids duplicate save CTAs', () => {
    const panelSource = fs.readFileSync(llmConfigPanelPath, 'utf8');
    expect(panelSource).toContain('data-testid="llm-test-connection"');
    expect(panelSource).toContain('data-testid="llm-save-choice"');
    expect(panelSource).toContain('data-testid={`llm-provider-${option}`}');
    expect(settingsApiSource).toContain("t('api.llm.diagnostics'");
    expect(settingsApiSource).not.toContain("t('api.llm.verifyAndSave'");
    expect(settingsApiSource).not.toContain("t('api.saveSettings'");
  });
});
