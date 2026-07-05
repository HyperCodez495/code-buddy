export interface DeliverablePreviewWiringEntry {
  id: string;
  title: string;
  componentFile: string;
  logicFile?: string;
  testFile?: string;
  mount: string;
  needsData: string[];
}

export const deliverablePreviewWiring: DeliverablePreviewWiringEntry[] = [
  {
    id: 'slide-deck-preview',
    title: 'Aperçu deck de slides',
    componentFile: 'cowork/src/renderer/components/deliverables/SlideDeckPreview.tsx',
    logicFile: 'cowork/src/renderer/components/deliverables/slide-deck-preview-model.ts',
    testFile: 'cowork/tests/deliverables/slide-deck-preview-model.test.ts',
    mount: 'deliverables.preview.deck',
    needsData: ['slides', 'activeIndex', 'onSelect'],
  },
  {
    id: 'sheet-preview',
    title: 'Aperçu feuille tabulaire',
    componentFile: 'cowork/src/renderer/components/deliverables/SheetPreview.tsx',
    logicFile: 'cowork/src/renderer/components/deliverables/sheet-preview-model.ts',
    testFile: 'cowork/tests/deliverables/sheet-preview-model.test.ts',
    mount: 'deliverables.preview.sheet',
    needsData: ['columns', 'rows', 'caption'],
  },
  {
    id: 'doc-preview',
    title: 'Aperçu document',
    componentFile: 'cowork/src/renderer/components/deliverables/DocPreview.tsx',
    logicFile: 'cowork/src/renderer/components/deliverables/doc-preview-model.ts',
    testFile: 'cowork/tests/deliverables/doc-preview-model.test.ts',
    mount: 'deliverables.preview.doc',
    needsData: ['blocks'],
  },
];
