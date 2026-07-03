/**
 * web_search formatting — the hardcoded weather card is GONE (2026-07-03
 * modernization): weather-ish queries get the normal result formatting, and
 * the dedicated `weather` tool owns the domain.
 */
import { describe, expect, it } from 'vitest';

import { WebSearchTool } from '../../src/tools/web-search.js';

type PrivateFormatter = {
  formatResults(results: Array<{ title: string; url: string; snippet: string }>, query: string): string;
};

const FIXTURE_RESULTS = [
  { title: 'Météo Paris — prévisions', url: 'https://example.tld/paris', snippet: 'Soleil et éclaircies, 21°C' },
  { title: 'Paris weather today', url: 'https://example.tld/weather', snippet: 'Sunny, light wind' },
];

describe('WebSearchTool.formatResults after the weather-hack removal', () => {
  it('formats a weather-ish query like any other query (no fake 🌍 Météo card)', () => {
    const tool = new WebSearchTool() as unknown as PrivateFormatter;
    const output = tool.formatResults(FIXTURE_RESULTS, 'météo Paris');
    expect(output).toContain('🔍 Résultats pour: "météo Paris"');
    expect(output).not.toContain('🌍 Météo');
  });

  it('the three hardcoded weather methods are gone', () => {
    const tool = new WebSearchTool() as unknown as Record<string, unknown>;
    expect(tool.isWeatherQuery).toBeUndefined();
    expect(tool.getWeatherEmoji).toBeUndefined();
    expect(tool.formatWeatherResults).toBeUndefined();
  });
});
