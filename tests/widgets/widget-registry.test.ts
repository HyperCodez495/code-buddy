/**
 * Widget registry — curated resolution, authored fallback (curated wins), and
 * SERVER-SIDE rendering (data interpolated into static HTML, no client script —
 * CSP-proof for inline srcdoc iframes). Pure/isolated (temp authored dir).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveWidgetSource,
  renderWidgetFragment,
  renderWidgetDocument,
  renderWidgetForData,
  hasWidgetForData,
  neutralizeUnsafeUrls,
} from '../../src/widgets/widget-registry.js';
import { widgetKind, type WeatherWidgetData } from '../../src/widgets/widget-types.js';

const sampleWeather: WeatherWidgetData = {
  type: 'weather',
  location: 'Paris',
  current: { temperature: 22, feelsLike: 24, condition: 'ensoleillé', humidity: 66, windSpeed: 6 },
  forecast: [{ day: 'jeu', min: 15, max: 24, condition: 'ensoleillé' }],
  units: 'metric',
};

describe('resolveWidgetSource', () => {
  it('returns curated for weather and news (case-insensitive)', () => {
    expect(resolveWidgetSource('weather')).toBe('curated');
    expect(resolveWidgetSource('news')).toBe('curated');
    expect(resolveWidgetSource('stock')).toBe('curated');
    expect(resolveWidgetSource('WEATHER')).toBe('curated');
  });

  it('returns null for an unknown kind with no authored widget', () => {
    // Isolated empty dir — an empty env would resolve to the REAL ~/.codebuddy/widgets.
    const env = { CODEBUDDY_WIDGETS_DIR: mkdtempSync(join(tmpdir(), 'wdg-empty-')) } as NodeJS.ProcessEnv;
    expect(resolveWidgetSource('unknown-stock', env)).toBeNull();
  });

  it('falls back to an authored widget for a NEW kind, but curated wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdg-'));
    const env = { CODEBUDDY_WIDGETS_DIR: dir } as NodeJS.ProcessEnv;
    // Authored widget for a novel kind 'stocksheet'.
    mkdirSync(join(dir, 'authored-stocksheet'), { recursive: true });
    writeFileSync(join(dir, 'authored-stocksheet', 'widget.html'), '<div>stocksheet</div>');
    expect(resolveWidgetSource('stocksheet', env)).toBe('authored');
    // An authored 'weather' must NOT shadow the curated one.
    mkdirSync(join(dir, 'authored-weather'), { recursive: true });
    writeFileSync(join(dir, 'authored-weather', 'widget.html'), '<div>evil</div>');
    expect(resolveWidgetSource('weather', env)).toBe('curated');
  });
});

describe('server-side rendering (no client script)', () => {
  it('renderWidgetForData interpolates the real data, wraps a full doc, and injects NO script', () => {
    const doc = renderWidgetForData(sampleWeather)!;
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('Paris'); // location interpolated directly into the HTML
    expect(doc).toContain('22°C'); // temperature rendered server-side
    expect(doc).not.toContain('window.__WIDGET_DATA__'); // no client-side data script
    expect(doc).not.toMatch(/<script/i); // CSP-proof: zero <script>
  });

  it('escapes injected values so they cannot break out of the markup', () => {
    const doc = renderWidgetForData({ type: 'weather', location: '</div><b>x', current: {} })!;
    expect(doc).not.toContain('</div><b>x'); // '<' and '>' are HTML-escaped
    expect(doc).toContain('&lt;'); // proof of escaping
  });

  it('renderWidgetFragment returns null for an unrecognized payload', () => {
    expect(renderWidgetFragment({ nope: true })).toBeNull();
    expect(renderWidgetFragment('not an object')).toBeNull();
  });

  it('renderWidgetForData returns null for an unrecognized payload', () => {
    expect(renderWidgetForData({ nope: true })).toBeNull();
  });

  it('renders the REAL WeatherTool forecast shape (high/low/date), not just min/max/day', () => {
    // WeatherTool.data.forecast items are { date, high, low, condition } — the
    // widget must map those, not render "—°".
    const doc = renderWidgetForData({
      type: 'weather',
      location: 'Lyon',
      current: { temperature: 33, condition: 'Sunny' },
      forecast: [{ date: '2026-07-09', high: 35, low: 24, condition: 'partly cloudy' }],
      units: 'metric',
    })!;
    expect(doc).toContain('35° / 24°'); // high/low rendered
    expect(doc).not.toContain('—°'); // no missing-value placeholder
    expect(doc).toContain('jeu'); // weekday derived from the ISO date (2026-07-09 = Thursday)
  });

  it('renders a news payload server-side with the item titles inline', () => {
    const doc = renderWidgetForData({
      type: 'news',
      title: 'À la une',
      items: [{ title: 'Titre A', source: 'Le Monde' }],
    })!;
    expect(doc).toContain('À la une');
    expect(doc).toContain('Titre A');
    expect(doc).not.toMatch(/<script/i);
  });

  it('renders a stock payload server-side with quote data inline', () => {
    const doc = renderWidgetForData({
      type: 'stock',
      name: 'CAC 40',
      symbol: 'PX1',
      price: '8 326,62',
      change: '1,20',
      changePercent: '0,36%',
      market: 'Euronext Paris',
      open: 8290,
      high: 8340,
      low: 8260,
      previousClose: '8 325,42',
      volume: '312 587',
      time: '18:05',
    })!;
    expect(doc).toContain('CAC 40');
    expect(doc).toContain('8 326,62');
    expect(doc).toContain('+0,36%');
    expect(doc).toContain('+1,20 pts');
    expect(doc).toContain('Hausse');
    expect(doc).toContain('Ouverture');
    expect(doc).toContain('Clôture veille');
    expect(doc).toContain('312,6');
    expect(doc).not.toMatch(/<script/i);
  });

  it('renderWidgetDocument wraps a fragment into a self-contained doc', () => {
    const doc = renderWidgetDocument('<div>hi</div>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<div>hi</div>');
  });

  it('stamps the host theme as data-cbw-theme on <html> (dark/light), none when omitted', () => {
    expect(renderWidgetDocument('<div>x</div>', 'dark')).toContain('<html data-cbw-theme="dark">');
    expect(renderWidgetForData(sampleWeather, undefined, 'dark')).toContain('data-cbw-theme="dark"');
    expect(renderWidgetDocument('<div>x</div>')).toContain('<html>'); // no attribute by default
  });
});

describe('security hardening (M1 URL schemes, M3 CSP)', () => {
  it('emits a self-defending CSP meta (script-src blocked) in the document', () => {
    const doc = renderWidgetForData(sampleWeather)!;
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toMatch(/<script/i);
    expect(doc).toContain('22°C'); // rendering unchanged
  });

  it('neutralizeUnsafeUrls blocks dangerous schemes but keeps http(s) and data:image', () => {
    expect(neutralizeUnsafeUrls('<a href="javascript:alert(1)">x</a>')).toContain('#blocked');
    expect(neutralizeUnsafeUrls('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(neutralizeUnsafeUrls('<img src="data:text/html,evil">')).toContain('#blocked');
    expect(neutralizeUnsafeUrls('<a href="https://example.com/a">x</a>')).toContain('https://example.com/a');
    expect(neutralizeUnsafeUrls('<img src="data:image/png;base64,AAA">')).toContain('data:image/png');
  });

  it('the curated news widget drops a javascript: link but keeps an http one', () => {
    const doc = renderWidgetForData({
      type: 'news',
      items: [
        { title: 'Evil', url: 'javascript:alert(1)' },
        { title: 'Good', url: 'https://example.com/article' },
      ],
    })!;
    expect(doc).not.toContain('javascript:');
    expect(doc).toContain('Evil'); // title still shown, just without a link
    expect(doc).toContain('https://example.com/article');
  });
});

describe('helpers', () => {
  it('widgetKind extracts the type', () => {
    expect(widgetKind({ type: 'weather' })).toBe('weather');
    expect(widgetKind({})).toBeNull();
  });
  it('hasWidgetForData', () => {
    expect(hasWidgetForData(sampleWeather)).toBe(true);
    const env = { CODEBUDDY_WIDGETS_DIR: mkdtempSync(join(tmpdir(), 'wdg-empty-')) } as NodeJS.ProcessEnv;
    expect(hasWidgetForData({ type: 'unknown-stock' }, env)).toBe(false);
  });
});
