import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const contextPanelPath = path.resolve(process.cwd(), 'src/renderer/components/ContextPanel.tsx');

describe('ContextPanel recent workspace files integration', () => {
  it('loads recent workspace files through electron artifacts API', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('window.electronAPI?.artifacts?.listRecentFiles');
    expect(source).toContain('setRecentWorkspaceFiles');
  });

  it('merges recent workspace files into the displayed artifacts list', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('const displayArtifacts = useMemo(() => {');
    expect(source).toContain('for (const file of recentWorkspaceFiles)');
  });

  it('shows role badges so generated deliverables stand out from extracted and recent files', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('getArtifactDisplayRole(step, fallbackPath)');
    expect(source).toContain('getArtifactDisplayRole(null)');
    expect(source).toContain('getArtifactDisplayRoleLabel(artifact.role)');
    expect(source).toContain('getArtifactDisplayRolePriority');
    expect(source).toContain('context.artifactRole.');
  });

  it('shows DOCX validation evidence under generated Word deliverables', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('getDocxValidationEvidence(step, fallbackPath)');
    expect(source).toContain('getDocxValidationEvidenceDisplay(artifact.evidence)');
    expect(source).toContain('artifact.evidence');
    expect(source).toContain('evidenceDisplay.labelKey');
    expect(source).toContain('evidenceDisplay.titleKey');
    expect(source).toContain('text-[10px] text-success truncate');
  });

  it('offers direct copy and reveal actions for artifact paths', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('const [copiedArtifactPath, setCopiedArtifactPath]');
    expect(source).toContain('const revealArtifact = async (artifactPath: string)');
    expect(source).toContain('const handleCopyArtifactPath = async (artifactPath: string)');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain("title={t('context.copyPath')}");
    expect(source).toContain("title={t('context.openInFileManager')}");
    expect(source).toContain('copiedArtifactPath === artifactPath');
    expect(source).toContain('<FolderOpen className="w-3 h-3" />');
  });

  it('opens artifact rows in the file preview pane before falling back to reveal', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath)');
    expect(source).toContain('const canPreviewArtifact =');
    expect(source).toContain('const openArtifact = async (artifactPath: string)');
    expect(source).toContain('setPreviewFilePath(artifactPath)');
    expect(source).toContain('data-testid={`context-artifact-row-${index}`}');
    expect(source).toContain('await openArtifact(artifactPath)');
  });

  it('renders a compact Word-workshop progress checklist when document work is detected', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('getDocumentWorkshopProgress(messages, steps, displayArtifacts.length)');
    expect(source).toContain('documentWorkshopProgress.visible');
    expect(source).toContain('data-testid="context-document-workshop"');
    expect(source).toContain('data-testid="context-document-workshop-progress"');
    expect(source).toContain('data-testid={`context-document-workshop-step-${step.id}`}');
    expect(source).toContain('documentWorkshopProgress.todos.length > 0');
    expect(source).toContain('data-testid="context-document-workshop-todos"');
    expect(source).toContain('data-testid={`context-document-workshop-todo-${todo.id}`}');
    expect(source).toContain('context.documentWorkshop.todoTitle');
    expect(source).toContain('data-testid="context-document-workshop-traceability"');
    expect(source).toContain('data-testid="context-document-workshop-traceability-progress"');
    expect(source).toContain('data-testid={`context-document-workshop-trace-${link.id}`}');
    expect(source).toContain('context.documentWorkshop.traceTitle');
    expect(source).toContain('context.documentWorkshop.trace.');
    expect(source).toContain('data-testid="context-document-workshop-trace-evidence"');
    expect(source).toContain('buildDocumentWorkshopEvidenceChips(documentWorkshopProgress)');
    expect(source).toContain('documentWorkshopEvidenceChips.map((chip)');
    expect(source).toContain('data-observed={chip.observed ?');
    expect(source).toContain("chip.observed");
    expect(source).toContain('getDocumentWorkshopReadiness(documentWorkshopProgress, displayArtifacts)');
    expect(source).toContain('data-testid="context-document-workshop-readiness"');
    expect(source).toContain('data-status={documentWorkshopReadiness.status}');
    expect(source).toContain('context.documentWorkshop.readiness.');
    expect(source).toContain('context.documentWorkshop.evidence.');
    expect(source).toContain('buildDocumentWorkshopMemoryContent(documentWorkshopProgress, displayArtifacts)');
    expect(source).toContain('data-testid="context-document-workshop-save-memory"');
    expect(source).toContain("addMemory('context', documentWorkshopMemoryContent)");
    expect(source).toContain('context.documentWorkshop.saveMemory');
    expect(source).toContain('context.documentWorkshop.title');
    expect(source).toContain('context.documentWorkshop.progress');
    expect(source).toContain('context.documentWorkshop.step.');
  });
});
