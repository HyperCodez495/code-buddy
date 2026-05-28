import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');
const enLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');
const frLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/fr.json');
const zhLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');

const REQUIRED_ONBOARDING_KEYS = [
  'title',
  'stepLabel',
  'languageTitle',
  'pathQuickTitle',
  'pathControlTitle',
  'pathLaterTitle',
  'providerTitle',
  'workspaceTitle',
  'capabilitiesTitle',
  'readyTitle',
  'skip',
  'finish',
];

interface LocaleUnderTest {
  common: Record<string, string>;
  onboarding: Record<string, string>;
}

function readLocale(filePath: string): LocaleUnderTest {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LocaleUnderTest;
}

describe('OnboardingWizard practical first-run UX', () => {
  it('turns the first-run path cards into direct actions', () => {
    const source = fs.readFileSync(onboardingPath, 'utf8');
    expect(source).toContain('data-testid="onboarding-close"');
    expect(source).toContain('action: () => setStep(1 as Step)');
    expect(source).toContain('action: () => setStep(2 as Step)');
    expect(source).toContain('action: () => void markComplete()');
    expect(source).toContain("t('onboarding.skip'");
    expect(source).toContain("t('onboarding.finish'");
  });

  it('ships localized onboarding copy instead of relying on English fallbacks', () => {
    const en = readLocale(enLocalePath);
    const fr = readLocale(frLocalePath);
    const zh = readLocale(zhLocalePath);

    for (const locale of [en, fr, zh]) {
      expect(locale.common.back).toBeTruthy();
      expect(locale.common.next).toBeTruthy();
      for (const key of REQUIRED_ONBOARDING_KEYS) {
        expect(locale.onboarding[key]).toBeTruthy();
      }
    }

    expect(fr.onboarding.title).toContain('Bienvenue');
    expect(fr.onboarding.stepLabel).toContain('Étape');
    expect(fr.onboarding.skip).toContain("Ignorer");
    expect(fr.onboarding.pathLaterTitle).toContain('Configurer plus tard');
  });
});
