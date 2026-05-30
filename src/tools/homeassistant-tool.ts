export type HomeAssistantToolName =
  | 'ha_list_entities'
  | 'ha_get_state'
  | 'ha_list_services'
  | 'ha_call_service';

export interface HomeAssistantToolOptions {
  url?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface HomeAssistantToolExecutionResult {
  kind: `${HomeAssistantToolName}_result`;
  ok: boolean;
  tool: HomeAssistantToolName;
  result?: unknown;
  request?: {
    method: 'GET' | 'POST';
    path: string;
  };
  error?: string;
}

interface HomeAssistantRequestOptions {
  baseUrl: string;
  token: string;
  fetchImpl: typeof fetch;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

const DEFAULT_HASS_URL = 'http://homeassistant.local:8123';
const ENTITY_ID_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/;
const SERVICE_NAME_RE = /^[a-z][a-z0-9_]*$/;
const BLOCKED_DOMAINS = new Set([
  'shell_command',
  'command_line',
  'python_script',
  'pyscript',
  'hassio',
  'rest_command',
]);

export async function executeHomeAssistantTool(
  tool: HomeAssistantToolName,
  input: Record<string, unknown>,
  options: HomeAssistantToolOptions = {},
): Promise<HomeAssistantToolExecutionResult> {
  const token = options.token ?? process.env.HASS_TOKEN ?? process.env.HOME_ASSISTANT_TOKEN;
  if (!token?.trim()) {
    return failure(tool, 'HASS_TOKEN is required for Home Assistant tool access');
  }
  const baseUrl = (options.url ?? process.env.HASS_URL ?? process.env.HOME_ASSISTANT_URL ?? DEFAULT_HASS_URL).trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failure(tool, 'fetch is not available in this runtime');
  }

  try {
    switch (tool) {
      case 'ha_list_entities':
        return await listEntities(input, { baseUrl, token, fetchImpl });
      case 'ha_get_state':
        return await getState(input, { baseUrl, token, fetchImpl });
      case 'ha_list_services':
        return await listServices(input, { baseUrl, token, fetchImpl });
      case 'ha_call_service':
        return await callService(input, { baseUrl, token, fetchImpl });
    }
  } catch (error) {
    return failure(tool, error instanceof Error ? error.message : String(error));
  }
}

export function getHomeAssistantBlockedDomains(): string[] {
  return [...BLOCKED_DOMAINS].sort();
}

async function listEntities(
  input: Record<string, unknown>,
  context: Pick<HomeAssistantRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<HomeAssistantToolExecutionResult> {
  const domain = optionalString(input, 'domain');
  const area = optionalString(input, 'area');
  if (domain) validateServiceName(domain, 'domain');

  const path = '/api/states';
  const states = await homeAssistantRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
  });
  const filtered = filterAndSummarizeStates(Array.isArray(states) ? states : [], domain, area);
  return success('ha_list_entities', filtered, 'GET', path);
}

async function getState(
  input: Record<string, unknown>,
  context: Pick<HomeAssistantRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<HomeAssistantToolExecutionResult> {
  const entityId = requiredEntityId(input);
  const path = `/api/states/${encodeURIComponent(entityId)}`;
  const data = asRecord(await homeAssistantRequest<unknown>({
    ...context,
    method: 'GET',
    path,
  }));
  const result = {
    entity_id: data.entity_id,
    state: data.state,
    attributes: asRecord(data.attributes),
    last_changed: data.last_changed,
    last_updated: data.last_updated,
  };
  return success('ha_get_state', result, 'GET', path);
}

async function listServices(
  input: Record<string, unknown>,
  context: Pick<HomeAssistantRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<HomeAssistantToolExecutionResult> {
  const domain = optionalString(input, 'domain');
  if (domain) validateServiceName(domain, 'domain');
  const path = '/api/services';
  const data = await homeAssistantRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
  });
  const services = Array.isArray(data) ? data : [];
  const filtered = domain ? services.filter((entry) => asRecord(entry).domain === domain) : services;
  const domains = filtered.map(compactServiceDomain);
  return success('ha_list_services', { count: domains.length, domains }, 'GET', path);
}

async function callService(
  input: Record<string, unknown>,
  context: Pick<HomeAssistantRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<HomeAssistantToolExecutionResult> {
  const domain = requiredServiceName(input, 'domain');
  const service = requiredServiceName(input, 'service');
  if (BLOCKED_DOMAINS.has(domain)) {
    return failure(
      'ha_call_service',
      `Service domain '${domain}' is blocked for security. Blocked domains: ${getHomeAssistantBlockedDomains().join(', ')}`,
    );
  }

  const entityId = optionalString(input, 'entity_id');
  if (entityId) validateEntityId(entityId);
  const body = buildServicePayload(entityId, input.data);
  const path = `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
  const data = await homeAssistantRequest<unknown>({
    ...context,
    method: 'POST',
    path,
    body,
  });
  const affectedEntities = Array.isArray(data)
    ? data.map((state) => ({
        entity_id: asRecord(state).entity_id ?? '',
        state: asRecord(state).state ?? '',
      }))
    : [];
  return success(
    'ha_call_service',
    {
      success: true,
      service: `${domain}.${service}`,
      affected_entities: affectedEntities,
    },
    'POST',
    path,
  );
}

async function homeAssistantRequest<T>(options: HomeAssistantRequestOptions): Promise<T> {
  const response = await options.fetchImpl(new URL(options.path, normalizeBaseUrl(options.baseUrl)), {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await response.text();
  const body = raw ? parseJson(raw) : null;
  if (!response.ok) {
    const reason = typeof body === 'object' && body && 'message' in body
      ? String((body as { message?: unknown }).message)
      : raw || response.statusText;
    throw new Error(`Home Assistant API error ${response.status}: ${reason}`);
  }
  return body as T;
}

function filterAndSummarizeStates(
  states: unknown[],
  domain?: string,
  area?: string,
): Record<string, unknown> {
  const areaLower = area?.toLowerCase();
  const entities = states
    .map(asRecord)
    .filter((state) => {
      const entityId = typeof state.entity_id === 'string' ? state.entity_id : '';
      if (domain && !entityId.startsWith(`${domain}.`)) {
        return false;
      }
      if (!areaLower) {
        return true;
      }
      const attributes = asRecord(state.attributes);
      const friendlyName = typeof attributes.friendly_name === 'string' ? attributes.friendly_name.toLowerCase() : '';
      const areaName = typeof attributes.area === 'string' ? attributes.area.toLowerCase() : '';
      return friendlyName.includes(areaLower) || areaName.includes(areaLower);
    })
    .map((state) => ({
      entity_id: state.entity_id,
      state: state.state,
      friendly_name: asRecord(state.attributes).friendly_name ?? '',
    }));

  return {
    count: entities.length,
    entities,
  };
}

function compactServiceDomain(entry: unknown): Record<string, unknown> {
  const record = asRecord(entry);
  const services = asRecord(record.services);
  const compacted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(services)) {
    const service = asRecord(value);
    const fields = asRecord(service.fields);
    const compactFields: Record<string, unknown> = {};
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      const field = asRecord(fieldValue);
      compactFields[fieldName] = field.description ?? '';
    }
    compacted[name] = {
      description: service.description ?? '',
      ...(Object.keys(compactFields).length > 0 ? { fields: compactFields } : {}),
    };
  }
  return {
    domain: record.domain ?? '',
    services: compacted,
  };
}

function buildServicePayload(entityId: string | undefined, data: unknown): Record<string, unknown> {
  let payload: Record<string, unknown> = {};
  if (typeof data === 'string' && data.trim()) {
    const parsed = parseJson(data);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('data must be a JSON object');
    }
    payload = { ...parsed as Record<string, unknown> };
  } else if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    payload = { ...data as Record<string, unknown> };
  } else if (data !== undefined && data !== null && data !== '') {
    throw new Error('data must be an object or JSON object string');
  }
  if (entityId) {
    payload.entity_id = entityId;
  }
  return payload;
}

function success(
  tool: HomeAssistantToolName,
  result: unknown,
  method: 'GET' | 'POST',
  path: string,
): HomeAssistantToolExecutionResult {
  return {
    kind: `${tool}_result`,
    ok: true,
    tool,
    result,
    request: { method, path },
  };
}

function failure(tool: HomeAssistantToolName, error: string): HomeAssistantToolExecutionResult {
  return {
    kind: `${tool}_result`,
    ok: false,
    tool,
    error,
  };
}

function requiredEntityId(input: Record<string, unknown>): string {
  const value = optionalString(input, 'entity_id');
  if (!value) {
    throw new Error('entity_id is required');
  }
  validateEntityId(value);
  return value;
}

function validateEntityId(value: string): void {
  if (!ENTITY_ID_RE.test(value)) {
    throw new Error(`Invalid entity_id format: ${value}`);
  }
}

function requiredServiceName(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  validateServiceName(value, key);
  return value;
}

function validateServiceName(value: string, label: string): void {
  if (!SERVICE_NAME_RE.test(value)) {
    throw new Error(`Invalid ${label} format: ${value}`);
  }
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
