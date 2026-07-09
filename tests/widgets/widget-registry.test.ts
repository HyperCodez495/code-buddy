/**
 * Widget registry — curated resolution, authored fallback (curated wins), and
 * safe data injection. Pure/isolated (temp authored dir).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveWidget,
  renderWidgetDocument,
  renderWidgetForData,
  hasWidgetForData,
} from '../../src/widgets/widget-registry.js';
import { widgetKind, type WeatherWidgetData } from '../../src/widgets/widget-types.js';

const sampleWeather: WeatherWidgetData = {
  type: 'weather',
  location: 'Paris',
  current: { temperature: 22, feelsLike: 24, condition: 'ensoleillé', humidity: 66, windSpeed: 6 },
  forecast: [{ day: 'jeu', min: 15, max: 24, condition: 'ensoleillé' }],
  units: 'metric',
};

describe('resolveWidget', () => {
  it('returns curated widgets for weather and news', () => {
    expect(resolveWidget('weather')?.source).toBe('curated');
    expect(resolveWidget('news')?.name).toBe('curated-news');
    expect(resolveWidget('WEATHER')?.kind).toBe('weather'); // case-insensitive
  });

  it('returns null for an unknown kind with no authored widget', () => {
    expect(resolveWidget('stock', {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('falls back to an authored widget for a NEW kind, but curated wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdg-'));
    const env = { CODEBUDDY_WIDGETS_DIR: dir } as NodeJS.ProcessEnv;
    // Authored widget for a novel kind 'stock'.
    mkdirSync(join(dir, 'authored-stock'), { recursive: true });
    writeFileSync(join(dir, 'authored-stock', 'widget.html'), '<div>stock</div>');
    expect(resolveWidget('stock', env)?.source).toBe('authored');
    // An authored 'weather' must NOT shadow the curated one.
    mkdirSync(join(dir, 'authored-weather'), { recursive: true });
    writeFileSync(join(dir, 'authored-weather', 'widget.html'), '<div>evil</div>');
    expect(resolveWidget('weather', env)?.source).toBe('curated');
  });
});

describe('renderWidgetDocument + data injection', () => {
  it('produces a self-contained doc with the data injected and no </script> breakout', () => {
    const spec = resolveWidget('weather')!;
    const doc = renderWidgetDocument(spec, { type: 'weather', location: '</script><b>x' });
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('window.__WIDGET_DATA__=');
    // The injected JSON must not contain a raw closing script tag.
    expect(doc).not.toContain('</script><b>x'); // escaped to <
    expect(doc).toContain('\\u003c/script');
  });

  it('renderWidgetForData resolves + renders, null for an unrecognized payload', () => {
    const doc = renderWidgetForData(sampleWeather);
    expect(doc).toContain('Paris'); // location travels in the injected JSON payload
    expect(doc).toContain('window.__WIDGET_DATA__');
    expect(renderWidgetForData({ nope: true })).toBeNull();
    expect(renderWidgetForData('not an object')).toBeNull();
  });
});

describe('helpers', () => {
  it('widgetKind extracts the type', () => {
    expect(widgetKind({ type: 'weather' })).toBe('weather');
    expect(widgetKind({})).toBeNull();
  });
  it('hasWidgetForData', () => {
    expect(hasWidgetForData(sampleWeather)).toBe(true);
    expect(hasWidgetForData({ type: 'stock' }, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
