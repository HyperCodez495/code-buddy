import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const companionPanelPath = path.resolve(__dirname, '../src/renderer/components/CompanionPanel.tsx');
const preloadPath = path.resolve(__dirname, '../src/preload/index.ts');

describe('companion gateway Fleet launch surface', () => {
  it('keeps gateway Fleet launch operator-approved and routed through fleet.dispatch', () => {
    const source = readFileSync(companionPanelPath, 'utf8');

    expect(source).toContain('Launch Fleet');
    expect(source).toContain('window.confirm(');
    expect(source).toContain('This will not send an outbound channel reply.');
    expect(source).toContain('window.electronAPI.fleet.dispatch(draft.dispatchInput)');
    expect(source).toContain("setBusyAction('gatewayFleetLaunch')");
    expect(source).toContain('gatewayFleetLaunch?.ok');
  });

  it('allows Fleet dispatch metadata needed by gateway handoffs through preload types', () => {
    const source = readFileSync(preloadPath, 'utf8');

    expect(source).toContain('deliveryChannel?: string;');
    expect(source).toContain('sourceSessionId?: string;');
    expect(source).toContain("privacyTag?: 'public' | 'sensitive';");
    expect(source).toContain('lintWarning?: string;');
  });
});
