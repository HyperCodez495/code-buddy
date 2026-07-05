/**
 * ComputerUseViewer — props-driven screen and local file perception surface.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ComputerUseViewer
 */

import { useTranslation } from 'react-i18next';
import { File, Folder, Monitor, MousePointer2 } from 'lucide-react';
import { countByExt, flattenTree, type FileNode } from '../utils/perception-model';

export interface ComputerUseViewerProps {
  screenshot?: string;
  files: FileNode[];
  onPick: (file: FileNode) => void;
}

interface FileTreeListProps {
  nodes: FileNode[];
  depth: number;
  onPick: (file: FileNode) => void;
}

function FileTreeList({ nodes, depth, onPick }: FileTreeListProps) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 space-y-1'}>
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            type="button"
            aria-label={`Choisir ${node.path}`}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid={`computer-file-${node.path}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => onPick(node)}
          >
            {node.type === 'directory' ? (
              <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <File aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate" title={node.path}>
              {node.name}
            </span>
          </button>
          {node.children && node.children.length > 0 && (
            <FileTreeList nodes={node.children} depth={depth + 1} onPick={onPick} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function ComputerUseViewer({ screenshot, files, onPick }: ComputerUseViewerProps) {
  const { t } = useTranslation();
  const flatFiles = flattenTree(files);
  const extCounts = countByExt(files);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="computer-use-viewer">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Monitor aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.computer.title', 'Computer Use')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {flatFiles.length} éléments vus · {Object.keys(extCounts).length} extensions
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Object.entries(extCounts)
            .slice(0, 4)
            .map(([ext, count]) => (
              <span key={ext} className="rounded-full bg-muted px-2 py-1">
                {ext}: {count}
              </span>
            ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {screenshot ? (
            <img className="max-h-[520px] w-full object-contain" src={screenshot} alt="Capture écran perçue par l’agent" />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Monitor aria-hidden="true" className="h-8 w-8" />
              {t('genspark.computer.noScreenshot', 'Aucune capture écran disponible.')}
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <MousePointer2 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {t('genspark.computer.files', 'Fichiers perçus')}
          </div>
          {files.length === 0 ? (
            <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
              {t('genspark.computer.empty', 'Aucun fichier perçu.')}
            </div>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <FileTreeList nodes={files} depth={0} onPick={onPick} />
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
