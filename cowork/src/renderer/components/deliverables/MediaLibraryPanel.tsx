/**
 * MediaLibraryPanel — the generated-media library (ChatGPT parity): every
 * image / video / audio the agent ever produced, across all session roots,
 * browsable and REUSABLE:
 *  - « Chat » seeds the Home composer with the media path (any module the
 *    agent drives — decks, apps, analyses — can then use the file);
 *  - « Studio » deep-links into the Image/Video studio seeded for a variant;
 *  - « Exporter » opens a native Save-As dialog;
 *  - « Dossier » reveals the file in the OS file manager;
 *  - « Copier » puts the absolute path on the clipboard.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clapperboard, Copy, Download, FolderOpen, Image as ImageIcon, Loader2, MessageCircle, MessageSquarePlus, Music, RefreshCw, Wand2 } from 'lucide-react';

import { useAppStore } from '../../store';
import { toFileUrl } from '../message/media-attachments-model.js';
import { filterMedia } from './media-filter-model.js';

interface MediaItem {
  path: string;
  kind: 'image' | 'video' | 'audio';
  size: number;
  mtimeMs: number;
  root: string;
  prompt?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
}

type Filter = 'all' | 'image' | 'video' | 'audio';

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} Mo`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} Ko`;
  return `${bytes} o`;
}

export function MediaLibraryPanel() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const setChatComposerSeed = useAppStore((s) => s.setChatComposerSeed);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setPrimaryView = useAppStore((s) => s.setPrimaryView);
  const setCreationsTab = useAppStore((s) => s.setCreationsTab);
  const setCreationsSeed = useAppStore((s) => s.setCreationsSeed);

  const refresh = useCallback(() => {
    void window.electronAPI?.media
      ?.list()
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(
    () => filterMedia(items ?? [], filter, query),
    [items, filter, query],
  );

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  };

  const handleUseInChat = (item: MediaItem) => {
    setChatComposerSeed(`En te servant du média ${item.path}, `);
    setActiveSession(null);
    setPrimaryView('chat');
  };

  const handleUseInStudio = (item: MediaItem) => {
    if (item.kind === 'audio') return;
    // With the original prompt (sidecar), a variant starts from the REAL
    // prompt; otherwise fall back to referencing the file path.
    setCreationsSeed(item.prompt ? `${item.prompt} — variante : ` : `Variante du média existant ${item.path} : `);
    setCreationsTab(item.kind === 'image' ? 'image' : 'video');
  };

  const openConversation = (item: MediaItem) => {
    if (!item.sessionId) return;
    setActiveSession(item.sessionId);
    setPrimaryView('chat');
  };

  const exportItem = (item: MediaItem) => {
    void window.electronAPI?.media?.export(item.path).then((result) => {
      if (result?.ok && result.savedTo) flash(`Exporté vers ${result.savedTo}`);
    });
  };

  const copyPath = (item: MediaItem) => {
    void navigator.clipboard.writeText(item.path).then(() => flash('Chemin copié'));
  };

  const counts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0 };
    for (const m of items ?? []) c[m.kind] += 1;
    return c;
  }, [items]);

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="media-library-panel">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {([
            ['all', `Tous · ${(items ?? []).length}`],
            ['image', `Images · ${counts.image}`],
            ['video', `Vidéos · ${counts.video}`],
            ['audio', `Audio · ${counts.audio}`],
          ] as Array<[Filter, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-full px-3 py-1 text-xs ${filter === id ? 'bg-accent text-background' : 'border border-border text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (prompt, modèle, nom)…"
            className="ml-auto w-56 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
            data-testid="media-search"
          />
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
            data-testid="media-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Rafraîchir
          </button>
        </div>

        {notice ? <p className="text-xs text-success">{notice}</p> : null}

        {items === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun média généré pour l'instant — demande une image, une vidéo ou une voix dans le chat ou les studios.
          </p>
        ) : (
          <div
            className="grid justify-start gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 260px))' }}
            data-testid="media-grid"
          >
            {filtered.map((item) => (
              <div key={item.path} className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex h-40 items-center justify-center bg-black/40">
                  {item.kind === 'image' ? (
                    <img src={toFileUrl(item.path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : item.kind === 'video' ? (
                    <video src={toFileUrl(item.path)} preload="metadata" controls className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex w-full flex-col items-center gap-2 px-3">
                      <Music className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <audio src={toFileUrl(item.path)} controls preload="metadata" className="w-full" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  {item.prompt ? (
                    <p className="mb-1 line-clamp-2 text-[11px] italic text-muted-foreground" title={item.prompt}>
                      « {item.prompt} »{item.model ? ` — ${item.model}` : ''}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {item.kind === 'image' ? <ImageIcon className="h-3 w-3" aria-hidden="true" /> : item.kind === 'video' ? <Clapperboard className="h-3 w-3" aria-hidden="true" /> : <Music className="h-3 w-3" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate" title={item.path}>{item.path.split('/').pop()}</span>
                    <span className="shrink-0 tabular-nums">{formatSize(item.size)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <button type="button" title="Utiliser dans le chat" onClick={() => handleUseInChat(item)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground" data-testid="media-use-chat">
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {item.kind !== 'audio' ? (
                      <button type="button" title="Variante dans le studio" onClick={() => handleUseInStudio(item)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground" data-testid="media-use-studio">
                        <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                    {item.sessionId ? (
                      <button type="button" title="Voir la conversation associée" onClick={() => openConversation(item)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground" data-testid="media-open-conversation">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button type="button" title="Copier le chemin" onClick={() => copyPath(item)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground">
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <span className="flex-1" />
                    <button type="button" title="Exporter…" onClick={() => exportItem(item)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground" data-testid="media-export">
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" title="Afficher dans le dossier" onClick={() => void window.electronAPI?.showItemInFolder?.(item.path)} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground">
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
