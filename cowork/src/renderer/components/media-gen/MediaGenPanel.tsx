import { useCallback, useMemo, useState } from 'react';
import { MediaGenComposer } from './MediaGenComposer.js';
import { MediaGallery } from './MediaGallery.js';
import type { MediaAspect, MediaGalleryItem, MediaMode } from './media-model.js';
import { createMediaGenApi } from './media-gen-wiring.js';

let seq = 0;
const nextId = (): string => `media-${Date.now()}-${(seq += 1)}`;

/**
 * The real image-generation studio: composer + gallery wired to the core
 * image_generate backend (via the preload `media` bridge). Video mode is
 * disabled here until a video route is wired. Degrades to a clear notice when
 * the bridge is unavailable (browser / engine not configured).
 */
export function MediaGenPanel() {
  const api = useMemo(() => createMediaGenApi(), []);
  const [mode, setMode] = useState<MediaMode>('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<MediaAspect>('1:1');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<MediaGalleryItem[]>([]);

  const onGenerate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!api) {
      setItems((prev) => [
        { id: nextId(), type: 'image', status: 'error', prompt: text, aspect, createdAt: Date.now() },
        ...prev,
      ]);
      return;
    }
    const id = nextId();
    setItems((prev) => [
      { id, type: 'image', status: 'generating', prompt: text, aspect, createdAt: Date.now() },
      ...prev,
    ]);
    setBusy(true);
    try {
      const res = await api.generateImage({ prompt: text, aspect });
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? res.ok
              ? { ...it, status: 'done', ...(res.url ? { url: res.url } : {}) }
              : { ...it, status: 'error' }
            : it,
        ),
      );
    } catch {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'error' } : it)));
    } finally {
      setBusy(false);
    }
  }, [api, prompt, aspect, busy]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="media-gen-panel">
      {!api ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          Backend de génération indisponible ici — lance Cowork avec le moteur embarqué (CODEBUDDY_ENGINE_PATH)
          et un fournisseur d’images (CODEBUDDY_IMAGE_PROVIDER=comfyui, ou une clé cloud).
        </p>
      ) : null}
      <MediaGenComposer
        mode={mode}
        prompt={prompt}
        aspect={aspect}
        busy={busy}
        onMode={setMode}
        onPrompt={setPrompt}
        onAspect={setAspect}
        onGenerate={onGenerate}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MediaGallery items={items} onRetry={() => void onGenerate()} />
      </div>
    </div>
  );
}
