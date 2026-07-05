import { LintProjectTool, LINT_PROJECT_TOOL_DEFINITION } from './lint-project-tool.js';
import { TestRunnerTool, TEST_RUNNER_TOOL_DEFINITION } from './test-runner-tool.js';
import { FormatProjectTool, FORMAT_PROJECT_TOOL_DEFINITION } from './format-project-tool.js';
import { BundleAnalyzeTool, BUNDLE_ANALYZE_TOOL_DEFINITION } from './bundle-analyze-tool.js';
import { BuildProjectTool, BUILD_PROJECT_TOOL_DEFINITION } from './build-project-tool.js';
import { LicenseCheckTool, LICENSE_CHECK_TOOL_DEFINITION } from './license-check-tool.js';
import { SbomGenerateTool, SBOM_GENERATE_TOOL_DEFINITION } from './sbom-generate-tool.js';
import { HttpProbeTool, HTTP_PROBE_TOOL_DEFINITION } from './http-probe-tool.js';
import { FileSearchTool, FILE_SEARCH_TOOL_DEFINITION } from './file-search-tool.js';
import { DiffFilesTool, DIFF_FILES_TOOL_DEFINITION } from './diff-files-tool.js';

export interface AuthoredToolManifest2Entry {
  name: string;
  classFile: string;
  className: string;
  definitionFile: string;
  registryFactory: string | null;
  metadata: {
    keywords: string[];
    priority: number;
    fleetSafe: boolean;
  };
  readOnly: boolean;
  testFile: string;
  toolClass: unknown;
  definition: unknown;
}

export const AUTHORED_TOOLS_MANIFEST_2: AuthoredToolManifest2Entry[] = [
  {
    name: 'lint_project',
    classFile: 'src/tools/lint-project-tool.ts',
    className: 'LintProjectTool',
    definitionFile: 'src/tools/lint-project-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['lint', 'eslint', 'quality'], priority: 80, fleetSafe: false },
    readOnly: false,
    testFile: 'tests/tools/lint-project-tool.test.ts',
    toolClass: LintProjectTool,
    definition: LINT_PROJECT_TOOL_DEFINITION,
  },
  {
    name: 'test_runner',
    classFile: 'src/tools/test-runner-tool.ts',
    className: 'TestRunnerTool',
    definitionFile: 'src/tools/test-runner-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['test', 'vitest', 'jest'], priority: 80, fleetSafe: false },
    readOnly: false,
    testFile: 'tests/tools/test-runner-tool.test.ts',
    toolClass: TestRunnerTool,
    definition: TEST_RUNNER_TOOL_DEFINITION,
  },
  {
    name: 'format_project',
    classFile: 'src/tools/format-project-tool.ts',
    className: 'FormatProjectTool',
    definitionFile: 'src/tools/format-project-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['format', 'prettier'], priority: 70, fleetSafe: false },
    readOnly: false,
    testFile: 'tests/tools/format-project-tool.test.ts',
    toolClass: FormatProjectTool,
    definition: FORMAT_PROJECT_TOOL_DEFINITION,
  },
  {
    name: 'bundle_analyze',
    classFile: 'src/tools/bundle-analyze-tool.ts',
    className: 'BundleAnalyzeTool',
    definitionFile: 'src/tools/bundle-analyze-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['bundle', 'dist', 'gzip'], priority: 70, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/bundle-analyze-tool.test.ts',
    toolClass: BundleAnalyzeTool,
    definition: BUNDLE_ANALYZE_TOOL_DEFINITION,
  },
  {
    name: 'build_project',
    classFile: 'src/tools/build-project-tool.ts',
    className: 'BuildProjectTool',
    definitionFile: 'src/tools/build-project-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['build', 'compile'], priority: 80, fleetSafe: false },
    readOnly: false,
    testFile: 'tests/tools/build-project-tool.test.ts',
    toolClass: BuildProjectTool,
    definition: BUILD_PROJECT_TOOL_DEFINITION,
  },
  {
    name: 'license_check',
    classFile: 'src/tools/license-check-tool.ts',
    className: 'LicenseCheckTool',
    definitionFile: 'src/tools/license-check-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['license', 'compliance', 'dependencies'], priority: 75, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/license-check-tool.test.ts',
    toolClass: LicenseCheckTool,
    definition: LICENSE_CHECK_TOOL_DEFINITION,
  },
  {
    name: 'sbom_generate',
    classFile: 'src/tools/sbom-generate-tool.ts',
    className: 'SbomGenerateTool',
    definitionFile: 'src/tools/sbom-generate-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['sbom', 'dependencies', 'supply-chain'], priority: 75, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/sbom-generate-tool.test.ts',
    toolClass: SbomGenerateTool,
    definition: SBOM_GENERATE_TOOL_DEFINITION,
  },
  {
    name: 'http_probe',
    classFile: 'src/tools/http-probe-tool.ts',
    className: 'HttpProbeTool',
    definitionFile: 'src/tools/http-probe-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['http', 'probe', 'loopback'], priority: 65, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/http-probe-tool.test.ts',
    toolClass: HttpProbeTool,
    definition: HTTP_PROBE_TOOL_DEFINITION,
  },
  {
    name: 'file_search',
    classFile: 'src/tools/file-search-tool.ts',
    className: 'FileSearchTool',
    definitionFile: 'src/tools/file-search-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['search', 'regex', 'files'], priority: 65, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/file-search-tool.test.ts',
    toolClass: FileSearchTool,
    definition: FILE_SEARCH_TOOL_DEFINITION,
  },
  {
    name: 'diff_files',
    classFile: 'src/tools/diff-files-tool.ts',
    className: 'DiffFilesTool',
    definitionFile: 'src/tools/diff-files-tool.ts',
    registryFactory: null,
    metadata: { keywords: ['diff', 'files', 'lcs'], priority: 65, fleetSafe: true },
    readOnly: true,
    testFile: 'tests/tools/diff-files-tool.test.ts',
    toolClass: DiffFilesTool,
    definition: DIFF_FILES_TOOL_DEFINITION,
  },
];
