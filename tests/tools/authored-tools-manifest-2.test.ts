import { describe, expect, it } from 'vitest';
import { AUTHORED_TOOLS_MANIFEST_2 } from '../../src/tools/authored-tools-manifest-2.js';

describe('AUTHORED_TOOLS_MANIFEST_2', () => {
  it('lists the ten core tools v2 with classes, definitions and tests', () => {
    expect(AUTHORED_TOOLS_MANIFEST_2).toHaveLength(10);
    expect(AUTHORED_TOOLS_MANIFEST_2.map((entry) => entry.name)).toEqual([
      'lint_project',
      'test_runner',
      'format_project',
      'bundle_analyze',
      'build_project',
      'license_check',
      'sbom_generate',
      'http_probe',
      'file_search',
      'diff_files',
    ]);
    for (const entry of AUTHORED_TOOLS_MANIFEST_2) {
      expect(entry.classFile).toMatch(/^src\/tools\/.+\.ts$/);
      expect(entry.testFile).toMatch(/^tests\/tools\/.+\.test\.ts$/);
      expect(entry.metadata.keywords.length).toBeGreaterThan(0);
      expect(entry.toolClass).toBeTypeOf('function');
      expect(entry.definition).toBeTypeOf('object');
    }
  });
});
