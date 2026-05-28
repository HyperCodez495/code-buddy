import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const frLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/fr.json');
const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');

interface FrenchSettingsLocale {
  skillsBrowser: Record<string, string>;
  snippets: Record<string, string>;
  customCommands: Record<string, string>;
  workspacePresets: Record<string, string>;
  hooks: Record<string, string>;
  a2a: Record<string, string>;
  plugins: Record<string, string>;
  telemetry: Record<string, string>;
  settingsServer: Record<string, string>;
  settingsCoreEngine: Record<string, string>;
}

describe('Settings navigation French labels', () => {
  it('has localized labels for every SettingsPanel navigation section', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    const locale = JSON.parse(fs.readFileSync(frLocalePath, 'utf8')) as FrenchSettingsLocale;

    expect(source).toContain("t('skillsBrowser.desc'");
    expect(locale.skillsBrowser.desc).toContain('Parcourir');
    expect(locale.snippets.settingsHint).toContain('invites réutilisables');
    expect(locale.customCommands.hint).toContain('Elles apparaissent');
    expect(locale.workspacePresets.hint).toContain('Enregistrez');
    expect(locale.hooks.title).toBe('Hooks et déclencheurs');
    expect(locale.a2a.hint).toContain('Google Agent-to-Agent');
    expect(locale.plugins.tabHint).toContain('composants');
    expect(locale.telemetry.title).toContain('Télémétrie');
    expect(locale.settingsServer.title).toBe('Serveur intégré');
    expect(locale.settingsCoreEngine.tabLabel).toBe('Moteur principal');
  });
});
