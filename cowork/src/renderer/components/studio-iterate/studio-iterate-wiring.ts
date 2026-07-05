export interface StudioIterateWiringItem {
  id: string;
  title: string;
  componentFile: string;
  logicFile?: string;
  testFile?: string;
  mount: 'labs';
  needsData: string[];
}

export const studioIterateWiring: StudioIterateWiringItem[] = [
  {
    id: 'studio-chat-panel',
    title: 'Chat d’itération App Studio',
    componentFile: 'cowork/src/renderer/components/studio-iterate/StudioChatPanel.tsx',
    logicFile: 'cowork/src/renderer/components/studio-iterate/iterate-model.ts',
    testFile: 'cowork/tests/studio-iterate/iterate-model.test.ts',
    mount: 'labs',
    needsData: ['messages', 'busy', 'suggestions', 'onSend', 'onStop'],
  },
  {
    id: 'changed-files-strip',
    title: 'Fichiers modifiés au dernier tour',
    componentFile: 'cowork/src/renderer/components/studio-iterate/ChangedFilesStrip.tsx',
    logicFile: 'cowork/src/renderer/components/studio-iterate/iterate-model.ts',
    testFile: 'cowork/tests/studio-iterate/iterate-model.test.ts',
    mount: 'labs',
    needsData: ['changes', 'onOpen'],
  },
  {
    id: 'preview-toolbar',
    title: 'Barre de test de preview',
    componentFile: 'cowork/src/renderer/components/studio-iterate/PreviewToolbar.tsx',
    logicFile: 'cowork/src/renderer/components/studio-iterate/iterate-model.ts',
    testFile: 'cowork/tests/studio-iterate/iterate-model.test.ts',
    mount: 'labs',
    needsData: ['url', 'status', 'device', 'onReload', 'onDevice', 'onOpenExternal', 'onToggle'],
  },
];
