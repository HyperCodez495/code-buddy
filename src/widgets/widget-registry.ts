/**
 * Widget registry — resolves the widget for a given data `kind` and renders it
 * into a self-contained sandboxed HTML document with the data injected.
 *
 * Curated widgets ship in-repo (weather, news). Authored widgets (generated on
 * the fly, Phase 2) live under ~/.codebuddy/widgets/<name>/widget.html and are
 * loaded lazily — but curated ALWAYS wins for a kind it covers (authored only
 * fills gaps, and can't shadow a curated one). never-throws.
 *
 * @module widgets/widget-registry
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WEATHER_WIDGET_HTML } from './curated/weather.js';
import { NEWS_WIDGET_HTML } from './curated/news.js';
import { widgetKind, type WidgetSpec } from './widget-types.js';

const CURATED: Record<string, string> = {
  weather: WEATHER_WIDGET_HTML,
  news: NEWS_WIDGET_HTML,
};

/** Root dir for authored widgets (env-overridable). */
export function authoredWidgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBUDDY_WIDGETS_DIR?.trim() || join(homedir(), '.codebuddy', 'widgets');
}

/** Resolve the widget for a kind: curated first, else an authored one if present. never-throws. */
export function resolveWidget(
  kind: string,
  env: NodeJS.ProcessEnv = process.env
): WidgetSpec | null {
  const k = (kind ?? '').trim().toLowerCase();
  if (!k) return null;
  if (CURATED[k]) return { name: `curated-${k}`, kind: k, html: CURATED[k]!, source: 'curated' };
  try {
    const p = join(authoredWidgetsDir(env), `authored-${k}`, 'widget.html');
    if (existsSync(p)) {
      const html = readFileSync(p, 'utf8');
      if (html.trim()) return { name: `authored-${k}`, kind: k, html, source: 'authored' };
    }
  } catch {
    /* no authored widget — fine */
  }
  return null;
}

/** JSON safe to inline inside a <script> tag (prevents a </script> breakout). */
function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}body{padding:2px}`;

/**
 * Wrap a widget fragment + its data into a complete, self-contained HTML document
 * (the data script runs BEFORE the widget's own script). Pure.
 */
export function renderWidgetDocument(spec: WidgetSpec, data: unknown): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${BASE_CSS}</style></head><body>` +
    `<script>window.__WIDGET_DATA__=${safeJson(data)};</script>` +
    spec.html +
    '</body></html>'
  );
}

/** Convenience: resolve + render for a tool's `data` payload. null when no widget fits. */
export function renderWidgetForData(
  data: unknown,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const kind = widgetKind(data);
  if (!kind) return null;
  const spec = resolveWidget(kind, env);
  return spec ? renderWidgetDocument(spec, data) : null;
}

/** True when SOME widget (curated or authored) can render this data. */
export function hasWidgetForData(data: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const kind = widgetKind(data);
  return !!kind && resolveWidget(kind, env) !== null;
}
