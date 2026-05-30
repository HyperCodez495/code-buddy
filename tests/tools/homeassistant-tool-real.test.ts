import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createHomeAssistantTools } from '../../src/tools/registry/homeassistant-tools.js';
import type { ITool } from '../../src/tools/registry/types.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes Home Assistant real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleHomeAssistantRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('lists entities and gets state through real Home Assistant HTTP endpoints', async () => {
    const listEntities = tool('ha_list_entities');
    const listResult = await listEntities.execute({
      domain: 'light',
      area: 'living',
    });

    expect(listResult.success, listResult.error).toBe(true);
    expect(JSON.parse(listResult.output as string)).toMatchObject({
      kind: 'ha_list_entities_result',
      ok: true,
      request: { method: 'GET', path: '/api/states' },
      result: {
        count: 1,
        entities: [
          {
            entity_id: 'light.living_room',
            state: 'on',
            friendly_name: 'Living Room Lamp',
          },
        ],
      },
    });

    const getState = tool('ha_get_state');
    const stateResult = await getState.execute({
      entity_id: 'sensor.temperature',
    });

    expect(stateResult.success, stateResult.error).toBe(true);
    expect(JSON.parse(stateResult.output as string)).toMatchObject({
      kind: 'ha_get_state_result',
      result: {
        entity_id: 'sensor.temperature',
        state: '21.4',
        attributes: {
          unit_of_measurement: 'C',
        },
      },
    });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        path: '/api/states',
        authorization: 'Bearer hass-test-token',
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/states/sensor.temperature',
        authorization: 'Bearer hass-test-token',
      }),
    ]));
  });

  it('lists services and calls a safe service through real HTTP', async () => {
    const listServices = tool('ha_list_services');
    const servicesResult = await listServices.execute({ domain: 'light' });

    expect(servicesResult.success, servicesResult.error).toBe(true);
    expect(JSON.parse(servicesResult.output as string)).toMatchObject({
      kind: 'ha_list_services_result',
      result: {
        count: 1,
        domains: [
          {
            domain: 'light',
            services: {
              turn_on: {
                description: 'Turn on a light',
                fields: {
                  brightness: 'Brightness value',
                },
              },
            },
          },
        ],
      },
    });

    const callService = tool('ha_call_service');
    const callResult = await callService.execute({
      domain: 'light',
      service: 'turn_on',
      entity_id: 'light.living_room',
      data: { brightness: 255, entity_id: 'light.other' },
    });

    expect(callResult.success, callResult.error).toBe(true);
    expect(JSON.parse(callResult.output as string)).toMatchObject({
      kind: 'ha_call_service_result',
      result: {
        success: true,
        service: 'light.turn_on',
        affected_entities: [
          {
            entity_id: 'light.living_room',
            state: 'on',
          },
        ],
      },
    });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'POST',
        path: '/api/services/light/turn_on',
        authorization: 'Bearer hass-test-token',
        body: {
          brightness: 255,
          entity_id: 'light.living_room',
        },
      }),
    ]));
  });

  it('blocks dangerous Home Assistant service domains before any network call', async () => {
    const callService = tool('ha_call_service');
    const result = await callService.execute({
      domain: 'shell_command',
      service: 'reboot',
      entity_id: 'shell_command.reboot',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Service domain 'shell_command' is blocked");
    expect(requests.some((request) => request.path.includes('/api/services/shell_command'))).toBe(false);
  });

  it('marks all official Hermes Home Assistant tools as exact local parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T20:00:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ha_list_entities', status: 'exact', detectedCodeBuddyTools: ['ha_list_entities'] }),
      expect.objectContaining({ name: 'ha_get_state', status: 'exact', detectedCodeBuddyTools: ['ha_get_state'] }),
      expect.objectContaining({ name: 'ha_list_services', status: 'exact', detectedCodeBuddyTools: ['ha_list_services'] }),
      expect.objectContaining({ name: 'ha_call_service', status: 'exact', detectedCodeBuddyTools: ['ha_call_service'] }),
    ]));
  });
});

function tool(name: string): ITool {
  const found = createHomeAssistantTools({ token: 'hass-test-token', url: baseUrl })
    .find((item) => item.name === name);
  expect(found).toBeTruthy();
  return found!;
}

async function handleHomeAssistantRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as unknown : undefined;
  const url = req.url ?? '/';
  requests.push({
    method: req.method ?? 'GET',
    path: url,
    authorization: req.headers.authorization,
    ...(parsedBody !== undefined ? { body: parsedBody } : {}),
  });

  if (req.method === 'GET' && url === '/api/states') {
    writeJson(res, [
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: {
          friendly_name: 'Living Room Lamp',
          area: 'Living Room',
        },
        last_changed: '2026-05-30T20:00:00.000Z',
        last_updated: '2026-05-30T20:00:00.000Z',
      },
      {
        entity_id: 'switch.kitchen',
        state: 'off',
        attributes: {
          friendly_name: 'Kitchen Switch',
          area: 'Kitchen',
        },
      },
      {
        entity_id: 'sensor.temperature',
        state: '21.4',
        attributes: {
          friendly_name: 'Temperature',
          unit_of_measurement: 'C',
        },
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url === '/api/states/sensor.temperature') {
    writeJson(res, {
      entity_id: 'sensor.temperature',
      state: '21.4',
      attributes: {
        friendly_name: 'Temperature',
        unit_of_measurement: 'C',
      },
      last_changed: '2026-05-30T19:55:00.000Z',
      last_updated: '2026-05-30T20:00:00.000Z',
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/services') {
    writeJson(res, [
      {
        domain: 'light',
        services: {
          turn_on: {
            description: 'Turn on a light',
            fields: {
              brightness: {
                description: 'Brightness value',
              },
            },
          },
        },
      },
      {
        domain: 'switch',
        services: {
          turn_off: {
            description: 'Turn off a switch',
          },
        },
      },
    ]);
    return;
  }

  if (req.method === 'POST' && url === '/api/services/light/turn_on') {
    expect(parsedBody).toEqual({
      brightness: 255,
      entity_id: 'light.living_room',
    });
    writeJson(res, [
      {
        entity_id: 'light.living_room',
        state: 'on',
      },
    ]);
    return;
  }

  res.statusCode = 404;
  writeJson(res, { message: `Unhandled ${req.method} ${url}` });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, data: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
