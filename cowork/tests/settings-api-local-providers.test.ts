import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const settingsApiPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsAPI.tsx'
);
const localProvidersPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsLocalProviders.tsx'
);

describe('Settings API local providers dashboard', () => {
  it('renders the local providers dashboard inside SettingsAPI', () => {
    const source = fs.readFileSync(settingsApiPath, 'utf8');
    expect(source).toContain("import { SettingsLocalProviders }");
    expect(source).toContain('<SettingsLocalProviders');
    expect(source).toContain('applyLocalProviderProfile');
  });

  it('supports both Ollama and LM Studio cards', () => {
    const source = fs.readFileSync(localProvidersPath, 'utf8');
    expect(source).toContain("id: 'ollama'");
    expect(source).toContain("id: 'lmstudio'");
    expect(source).toContain('window.electronAPI.config.modelInventory');
    expect(source).toContain("window.electronAPI.config.discoverLocal()");
    expect(source).toContain("window.electronAPI.config.discoverLocalLmStudio()");
    expect(source).toContain('Machine');
    expect(source).toContain('Benchmark');
  });
});
