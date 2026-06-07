/**
 * Desktop snapshot IPC bridge.
 *
 * Exposes the core smart snapshot system to Cowork as a passive inspection
 * surface: capture, OCR/accessibility refs, and annotated preview. It does not
 * perform mouse or keyboard actions.
 */

import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';
import { errorMessage } from './ipc-workdir';

type DesktopSnapshotMethod = 'accessibility' | 'ocr' | 'hybrid';

interface DesktopSnapshotInput {
  method?: DesktopSnapshotMethod;
  interactiveOnly?: boolean;
  includeAnnotatedImage?: boolean;
  cropAnnotatedImage?: boolean;
  ttlMs?: number;
  window?: string;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointLike {
  x: number;
  y: number;
}

interface UiElementLike {
  ref: number;
  role: string;
  name: string;
  description?: string;
  bounds: RectLike;
  center: PointLike;
  interactive: boolean;
  focused: boolean;
  enabled: boolean;
  visible: boolean;
  value?: string;
  placeholder?: string;
  automationId?: string;
  runtimeId?: string;
  controlType?: string;
  className?: string;
  attributes?: Record<string, unknown>;
}

interface SnapshotLike {
  id: string;
  timestamp: Date | string;
  source: string;
  elements: UiElementLike[];
  screenSize: { width: number; height: number };
  valid: boolean;
  ttl: number;
}

interface AnnotatedScreenshotLike {
  image: string;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

interface SmartSnapshotManagerLike {
  takeSnapshot: (options?: { window?: string; interactiveOnly?: boolean; ttl?: number }) => Promise<SnapshotLike>;
  toTextRepresentation: (snapshot?: SnapshotLike) => string;
  toAnnotatedScreenshot: (options?: {
    interactiveOnly?: boolean;
    crop?: boolean;
  }) => Promise<AnnotatedScreenshotLike | null>;
}

interface DesktopAutomationCoreMod {
  SmartSnapshotManager?: new (config?: {
    method?: DesktopSnapshotMethod;
    defaultTtl?: number;
    enableAnnotations?: boolean;
  }) => SmartSnapshotManagerLike;
}

async function loadDesktopAutomation(): Promise<DesktopAutomationCoreMod | null> {
  return loadCoreModule<DesktopAutomationCoreMod>('desktop-automation/index.js');
}

function normalizeMethod(method: unknown): DesktopSnapshotMethod {
  return method === 'accessibility' || method === 'ocr' || method === 'hybrid' ? method : 'hybrid';
}

function normalizeTtl(ttlMs: unknown): number {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) return 15_000;
  return Math.max(1_000, Math.min(120_000, Math.round(ttlMs)));
}

function serializeSnapshot(snapshot: SnapshotLike) {
  const timestamp =
    snapshot.timestamp instanceof Date ? snapshot.timestamp.toISOString() : new Date(snapshot.timestamp).toISOString();

  return {
    id: snapshot.id,
    timestamp,
    source: snapshot.source,
    screenSize: snapshot.screenSize,
    valid: snapshot.valid,
    ttl: snapshot.ttl,
    elements: snapshot.elements.map((element) => ({
      ref: element.ref,
      role: element.role,
      name: element.name,
      description: element.description,
      bounds: element.bounds,
      center: element.center,
      interactive: element.interactive,
      focused: element.focused,
      enabled: element.enabled,
      visible: element.visible,
      value: element.value,
      placeholder: element.placeholder,
      automationId: element.automationId,
      runtimeId: element.runtimeId,
      controlType: element.controlType,
      className: element.className,
      attributes: element.attributes,
    })),
  };
}

export function registerDesktopSnapshotIpcHandlers(): void {
  ipcMain.handle('desktopSnapshot.status', async () => {
    try {
      const mod = await loadDesktopAutomation();
      return {
        ok: Boolean(mod?.SmartSnapshotManager),
        platform: process.platform,
        methods: ['accessibility', 'ocr', 'hybrid'] as DesktopSnapshotMethod[],
        error: mod?.SmartSnapshotManager ? undefined : 'core desktop automation module unavailable',
      };
    } catch (err) {
      logError('[desktopSnapshot.status] failed:', err);
      return { ok: false as const, platform: process.platform, error: errorMessage(err) };
    }
  });

  ipcMain.handle('desktopSnapshot.capture', async (_event, input?: DesktopSnapshotInput) => {
    try {
      const mod = await loadDesktopAutomation();
      if (!mod?.SmartSnapshotManager) {
        return { ok: false as const, error: 'core desktop automation module unavailable' };
      }

      const method = normalizeMethod(input?.method);
      const ttl = normalizeTtl(input?.ttlMs);
      const manager = new mod.SmartSnapshotManager({
        method,
        defaultTtl: ttl,
        enableAnnotations: input?.includeAnnotatedImage !== false,
      });
      const snapshot = await manager.takeSnapshot({
        window: input?.window,
        interactiveOnly: input?.interactiveOnly,
        ttl,
      });
      const text = manager.toTextRepresentation(snapshot);
      const annotated =
        input?.includeAnnotatedImage === false
          ? null
          : await manager.toAnnotatedScreenshot({
              interactiveOnly: input?.interactiveOnly ?? true,
              crop: input?.cropAnnotatedImage ?? true,
            });

      return {
        ok: true as const,
        method,
        snapshot: serializeSnapshot(snapshot),
        text,
        annotatedImage: annotated
          ? {
              dataUrl: `data:image/${annotated.format};base64,${annotated.image}`,
              format: annotated.format,
              width: annotated.width,
              height: annotated.height,
            }
          : null,
      };
    } catch (err) {
      logError('[desktopSnapshot.capture] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });
}
