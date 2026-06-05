import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GUI accessibility & i18n audit — Wave 1 regression guards.
 *
 * Source-based assertions (same lightweight convention as
 * enrollment-dialog-i18n.test.ts): they lock in the Wave 1 fixes so a future
 * edit that drops a focus-trap, an aria-label, re-hardcodes a string, or
 * removes a locale key fails loudly. Rendering each modal would need heavy
 * store/IPC mocking for no extra signal here.
 */

const comp = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), `src/renderer/components/${rel}`), 'utf8');

const localePaths = ['en', 'fr', 'zh'].map((l) =>
  path.resolve(process.cwd(), `src/renderer/i18n/locales/${l}.json`)
);
const locale = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, Record<string, unknown>>;

// Modals that must trap focus + expose dialog semantics via the a11y helper.
const TRAP_FOCUS_MODALS = [
  'ApprovalDialog.tsx',
  'CompactStrategyDialog.tsx',
  'EnrollmentDialog.tsx',
  'ExportShareableDialog.tsx',
  'HooksDryRunDialog.tsx',
  'PRComposer.tsx',
  'WatchedFilesPanel.tsx',
];

// Components whose icon-only buttons must carry an accessible label.
const ARIA_LABEL_COMPONENTS = [
  'WatchedFilesPanel.tsx',
  'HooksDryRunDialog.tsx',
  'PRComposer.tsx',
  'ExportShareableDialog.tsx',
  'message/CodeBlock.tsx',
];

describe('GUI a11y audit — Wave 1', () => {
  it('wires the shared focus-trap helper into every audited modal', () => {
    for (const file of TRAP_FOCUS_MODALS) {
      const src = comp(file);
      expect(src, `${file}: trapFocus`).toContain('trapFocus');
      expect(src, `${file}: dialogA11yProps`).toContain('dialogA11yProps');
    }
  });

  it('gives icon-only buttons an accessible label', () => {
    for (const file of ARIA_LABEL_COMPONENTS) {
      expect(comp(file), `${file}: aria-label`).toContain('aria-label');
    }
  });

  it('PresenceIndicator is internationalized and theme-tokened (no hardcoded French / hex palette)', () => {
    const src = comp('PresenceIndicator.tsx');
    expect(src).toContain('useTranslation');
    expect(src).toContain("'presence.");
    // The former hardcoded French copy must be gone.
    expect(src).not.toContain('Enregistrer un visage');
    expect(src).not.toContain('Visage inconnu');
    // Palette must use theme tokens, not raw Tailwind colors.
    expect(src).toContain('text-success');
    expect(src).not.toMatch(/text-emerald-\d/);
    expect(src).not.toMatch(/text-zinc-\d/);
  });

  it('ships the new audited i18n sections for all supported locales', () => {
    const required: Record<string, string[]> = {
      presence: ['unknown', 'enrollFace', 'enrolledCount_one', 'enrolledCount_other'],
      approval: ['title', 'destructiveDetected', 'approve', 'reject'],
      compact: ['dialogTitle', 'aggressive', 'balanced', 'preserveTools'],
      team: ['title', 'startTeam', 'addMember'],
    };
    for (const p of localePaths) {
      const data = locale(p);
      for (const [section, keys] of Object.entries(required)) {
        expect(data[section], `${path.basename(p)}:${section}`).toBeTruthy();
        for (const key of keys) {
          expect(data[section][key], `${path.basename(p)}:${section}.${key}`).toBeTruthy();
        }
      }
    }
  });
});
