import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const shellNavigationPath = path.resolve(process.cwd(), 'src/renderer/components/ShellNavigation.tsx');
const focusViewPath = path.resolve(process.cwd(), 'src/renderer/components/FocusView.tsx');

describe('focus view surface', () => {
  it('wires the focus view into App shortcuts and overlay rendering', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    expect(source).toContain("import { FocusView }");
    expect(source).toContain("setShowFocusView(true)");
    expect(source).toContain('showFocusView && (');
    expect(source).toContain('<FocusView');
  });

  it('adds a shell navigation entry for the focus view', () => {
    const source = fs.readFileSync(shellNavigationPath, 'utf8');
    expect(source).toContain("setShowFocusView(true)");
    expect(source).toContain("testId: 'focus-view-button'");
    expect(source).toContain('data-testid={action.testId}');
  });

  it('renders empty-state and recent-step sections in the focus view', () => {
    const source = fs.readFileSync(focusViewPath, 'utf8');
    expect(source).toContain('data-testid="focus-view"');
    expect(source).toContain('data-testid="focus-view-empty"');
    expect(source).toContain("t('focusView.recentSteps'");
  });
});
