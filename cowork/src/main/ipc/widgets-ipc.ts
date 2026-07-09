import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

type WidgetTheme = 'dark' | 'light';

interface WidgetRegistryModule {
  hasWidgetForData?: (data: unknown) => boolean;
  renderWidgetForData?: (data: unknown, env?: unknown, theme?: WidgetTheme) => string | null;
}

interface WidgetEngineModule {
  resolveOrGenerate?: (data: unknown, deps?: { theme?: WidgetTheme }) => Promise<string | null>;
}

function normalizeTheme(theme: unknown): WidgetTheme | undefined {
  return theme === 'dark' || theme === 'light' ? theme : undefined;
}

function hasStructuredType(data: unknown): data is { type: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

export function registerWidgetsIpcHandlers(): void {
  ipcMain.handle('widgets.render', async (_event, data: unknown, theme?: unknown): Promise<string | null> => {
    if (!hasStructuredType(data)) return null;
    const t = normalizeTheme(theme);

    try {
      // Prefer the engine: it renders known kinds instantly AND, when opted in
      // (CODEBUDDY_WIDGETS=true), authors+gates+keeps a widget for a NEW kind.
      // Default off ⇒ behaves exactly like renderWidgetForData. never-throws.
      try {
        const engine = await loadCoreModule<WidgetEngineModule>('widgets/widget-engine.js');
        if (engine?.resolveOrGenerate) {
          const html = await engine.resolveOrGenerate(data, { theme: t });
          if (typeof html === 'string' && html.trim().length > 0) return html;
          // engine returned null (miss + generation off/failed) → fall through to registry
        }
      } catch (engineError) {
        logError('[widgets-ipc] engine unavailable, falling back to registry:', engineError);
      }

      const mod = await loadCoreModule<WidgetRegistryModule>('widgets/widget-registry.js');
      if (!mod?.renderWidgetForData) return null;
      if (mod.hasWidgetForData && !mod.hasWidgetForData(data)) return null;

      const html = mod.renderWidgetForData(data, undefined, t);
      return typeof html === 'string' && html.trim().length > 0 ? html : null;
    } catch (error) {
      logError('[widgets-ipc] failed to render widget:', error);
      return null;
    }
  });
}
