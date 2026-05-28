import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const enrollmentDialogPath = path.resolve(
  process.cwd(),
  'src/renderer/components/EnrollmentDialog.tsx'
);

const localePaths = ['en', 'fr', 'zh'].map((locale) =>
  path.resolve(process.cwd(), `src/renderer/i18n/locales/${locale}.json`)
);

const enrollmentKeys = [
  'title',
  'nameLabel',
  'aliasesLabel',
  'aliasesHelp',
  'samplesLabel',
  'errorLabel',
  'capture',
  'noFaceDetected',
  'modelMissing',
] as const;

describe('EnrollmentDialog i18n', () => {
  it('uses renderer translations for user-facing enrollment copy', () => {
    const source = fs.readFileSync(enrollmentDialogPath, 'utf8');
    expect(source).toContain('useTranslation');
    expect(source).toContain("'enrollment.title'");
    expect(source).toContain("'enrollment.noFaceDetected'");
    expect(source).toContain("'enrollment.modelMissing'");
    expect(source).toContain("'enrollment.capture'");
    expect(source).toContain("'common.cancel'");
  });

  it('ships enrollment copy for all supported locales', () => {
    for (const localePath of localePaths) {
      const locale = JSON.parse(fs.readFileSync(localePath, 'utf8')) as {
        enrollment: Record<string, string>;
      };
      for (const key of enrollmentKeys) {
        expect(locale.enrollment[key], `${path.basename(localePath)}:${key}`).toBeTruthy();
      }
    }
  });
});
