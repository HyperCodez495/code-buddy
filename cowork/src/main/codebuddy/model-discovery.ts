import type { ProviderModelInfo } from '../../renderer/types';

const CODEBUDDY_DISCOVERY_TIMEOUT_MS = 8000;

export interface CodeBuddyDiscoveryInput {
  endpoint: string;
  apiKey?: string;
}

export interface CodeBuddyConnectionProbeResult {
  version: string;
  models: string[];
  tools: number;
}

function endpointUrl(endpoint: string, path: string): string {
  const base = endpoint.trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('Code Buddy endpoint is required.');
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function buildHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }
  return headers;
}

async function readJsonResponse(response: Response, context: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse ${context} response: ${text.substring(0, 200)}`);
  }
}

function normalizeModelInfo(payload: unknown): ProviderModelInfo[] {
  const rawModels = (payload as { data?: unknown; models?: unknown })?.data
    ?? (payload as { models?: unknown })?.models
    ?? [];
  if (!Array.isArray(rawModels)) return [];
  return rawModels
    .map((model) => {
      if (typeof model === 'string') {
        const id = model.trim();
        return id ? { id, name: id } : null;
      }
      if (model && typeof model === 'object' && 'id' in model) {
        const id = String((model as { id?: unknown }).id ?? '').trim();
        return id ? { id, name: id } : null;
      }
      return null;
    })
    .filter((item: ProviderModelInfo | null): item is ProviderModelInfo => Boolean(item));
}

function readToolCount(payload: unknown): number {
  const metrics = payload as { toolCount?: unknown; tools?: unknown };
  const count =
    typeof metrics.toolCount === 'number'
      ? metrics.toolCount
      : typeof metrics.tools === 'number'
        ? metrics.tools
        : 0;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export async function listCodeBuddyModels(
  input: CodeBuddyDiscoveryInput,
): Promise<ProviderModelInfo[]> {
  const response = await fetch(endpointUrl(input.endpoint, '/v1/models'), {
    method: 'GET',
    headers: buildHeaders(input.apiKey),
    signal: AbortSignal.timeout(CODEBUDDY_DISCOVERY_TIMEOUT_MS),
  });
  const data = await readJsonResponse(response, 'Code Buddy models');
  return normalizeModelInfo(data);
}

export async function probeCodeBuddyConnection(
  input: CodeBuddyDiscoveryInput,
): Promise<CodeBuddyConnectionProbeResult> {
  const healthResponse = await fetch(endpointUrl(input.endpoint, '/api/health'), {
    method: 'GET',
    headers: buildHeaders(input.apiKey),
    signal: AbortSignal.timeout(CODEBUDDY_DISCOVERY_TIMEOUT_MS),
  });
  const health = (await readJsonResponse(healthResponse, 'Code Buddy health')) as {
    version?: unknown;
  };

  let models: string[] = [];
  try {
    models = (await listCodeBuddyModels(input)).map((model) => model.id);
  } catch {
    models = [];
  }

  let tools = 0;
  try {
    const metricsResponse = await fetch(endpointUrl(input.endpoint, '/api/metrics'), {
      method: 'GET',
      headers: buildHeaders(input.apiKey),
      signal: AbortSignal.timeout(CODEBUDDY_DISCOVERY_TIMEOUT_MS),
    });
    tools = readToolCount(await readJsonResponse(metricsResponse, 'Code Buddy metrics'));
  } catch {
    tools = 0;
  }

  return {
    version: typeof health.version === 'string' ? health.version : 'unknown',
    models,
    tools,
  };
}
