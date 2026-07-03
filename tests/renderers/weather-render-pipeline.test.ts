/**
 * Tool ↔ renderer contract — the EXACT WeatherData emitted by the real
 * WeatherTool (loopback Open-Meteo round-trip, no mocked transport) must pass
 * the previously-orphaned weather renderer's canRender and render in both
 * modes. Pins the contract for the future RendererManager ← ToolResult.data
 * wiring.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WeatherTool } from '../../src/tools/weather.js';
import { weatherRenderer } from '../../src/renderers/weather-renderer.js';
import type { RenderContext, WeatherData } from '../../src/renderers/types.js';
import { CONDITION_EMOJI } from '../../src/renderers/weather-conditions.js';

const GEOCODE_PARIS = {
  results: [{ name: 'Paris', country: 'France', latitude: 48.85, longitude: 2.35 }],
};

const FORECAST_OK = {
  current: {
    temperature_2m: 21.4,
    apparent_temperature: 23.1,
    relative_humidity_2m: 55,
    weather_code: 2,
    wind_speed_10m: 12.3,
  },
  daily: {
    time: ['2026-07-04', '2026-07-05'],
    temperature_2m_max: [27.2, 24.0],
    temperature_2m_min: [18.1, 16.5],
    weather_code: [0, 61],
    precipitation_probability_max: [10, 80],
  },
};

function ctx(mode: 'plain' | 'fancy'): RenderContext {
  return { mode, color: false, emoji: mode === 'fancy', width: 80, height: 24, piped: false };
}

describe('weather tool → weather renderer contract', () => {
  let server: http.Server;
  let data: WeatherData;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/v1/search') res.end(JSON.stringify(GEOCODE_PARIS));
      else if (url.pathname === '/v1/forecast') res.end(JSON.stringify(FORECAST_OK));
      else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await new WeatherTool({
      geocodingBaseUrl: baseUrl,
      forecastBaseUrl: baseUrl,
    }).getWeather('Paris', 2);
    expect(result.success).toBe(true);
    data = result.data as WeatherData;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("the tool's data payload is accepted by canRender", () => {
    expect(weatherRenderer.canRender(data)).toBe(true);
  });

  it('renders in plain mode with location, temperature and forecast', () => {
    const out = weatherRenderer.render(data, ctx('plain'));
    expect(out).toContain('Weather for Paris, France');
    expect(out).toContain('21.4°C');
    expect(out).toContain('Forecast:');
    expect(out).toContain('2026-07-05');
  });

  it('renders in fancy mode using the canonical emoji table', () => {
    const out = weatherRenderer.render(data, ctx('fancy'));
    expect(out).toContain('Weather: Paris, France');
    // Current condition is partly-cloudy (WMO 2) — its canonical emoji shows.
    expect(out).toContain(CONDITION_EMOJI['partly-cloudy']);
    // Day 2 is rain (WMO 61) — forecast row uses the same table.
    expect(out).toContain(CONDITION_EMOJI['rain']);
    // Box drawing means the layout actually rendered.
    expect(out).toContain('┌');
    expect(out).toContain('└');
  });
});
