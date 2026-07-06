/**
 * Wiring manifest for wave 38 (bolt.new enrichment) — data-only, no component
 * imports. The integrator (Fable) wires these into App Studio.
 */
export interface BoltNewSlice {
  id: string;
  title: string;
  componentFile: string;
  logicFile?: string;
  testFile?: string;
  mount: 'app-studio';
  needsData: string;
}

export const BOLT_NEW_SLICES: BoltNewSlice[] = [
  {
    id: '38.1',
    title: 'VerifyReportCard',
    componentFile: 'components/studio/VerifyReportCard.tsx',
    logicFile: 'components/studio/web-test-report-model.ts',
    testFile: 'tests/web-test-report-model.test.ts',
    mount: 'app-studio',
    needsData: 'Un WebTestReport (parsé du ToolResult web_test) + onRerun.',
  },
  {
    id: '38.2',
    title: 'EditorTabs',
    componentFile: 'components/studio/EditorTabs.tsx',
    logicFile: 'components/studio/editor-tabs-model.ts',
    testFile: 'tests/editor-tabs-model.test.ts',
    mount: 'app-studio',
    needsData: 'tabs[] + activePath + onSelect/onClose (le parent gère la liste).',
  },
  {
    id: '38.3',
    title: 'PromptEnhancer',
    componentFile: 'components/studio/PromptEnhancer.tsx',
    logicFile: 'components/studio/prompt-enhance-model.ts',
    testFile: 'tests/prompt-enhance-model.test.ts',
    mount: 'app-studio',
    needsData: 'enhancePrompt(prompt) → { suggestions, enriched } ; onApply(enriched).',
  },
  {
    id: '38.4',
    title: 'StaticPreviewNotice',
    componentFile: 'components/studio/StaticPreviewNotice.tsx',
    logicFile: 'components/studio/static-project-model.ts',
    testFile: 'tests/static-project-model.test.ts',
    mount: 'app-studio',
    needsData: 'describePreviewMode(tree) + previewEntry(tree).',
  },
];
