export type SpotifyToolName =
  | 'spotify_playback'
  | 'spotify_devices'
  | 'spotify_queue'
  | 'spotify_search'
  | 'spotify_playlists'
  | 'spotify_albums'
  | 'spotify_library';

export interface SpotifyToolOptions {
  accessToken?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SpotifyToolExecutionResult {
  kind: `${SpotifyToolName}_result`;
  ok: boolean;
  tool: SpotifyToolName;
  action?: string;
  result?: unknown;
  request?: {
    method: SpotifyHttpMethod;
    path: string;
  };
  error?: string;
}

type SpotifyHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueryValue = string | number | boolean | undefined | null;

interface SpotifyRequestOptions {
  baseUrl: string;
  token: string;
  fetchImpl: typeof fetch;
  method: SpotifyHttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  emptyResponse?: Record<string, unknown>;
}

const DEFAULT_SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SEARCH_TYPES = new Set(['album', 'artist', 'playlist', 'track', 'show', 'episode', 'audiobook']);
const REPEAT_STATES = new Set(['track', 'context', 'off']);

export async function executeSpotifyTool(
  tool: SpotifyToolName,
  input: Record<string, unknown>,
  options: SpotifyToolOptions = {},
): Promise<SpotifyToolExecutionResult> {
  const token = options.accessToken
    ?? process.env.SPOTIFY_ACCESS_TOKEN
    ?? process.env.CODEBUDDY_SPOTIFY_ACCESS_TOKEN
    ?? process.env.SPOTIFY_TOKEN;
  if (!token?.trim()) {
    return failure(tool, 'SPOTIFY_ACCESS_TOKEN is required for Spotify tool access');
  }

  const baseUrl = (options.apiBaseUrl
    ?? process.env.SPOTIFY_API_BASE_URL
    ?? process.env.CODEBUDDY_SPOTIFY_API_BASE_URL
    ?? DEFAULT_SPOTIFY_API_BASE_URL).trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failure(tool, 'fetch is not available in this runtime');
  }

  const context = { baseUrl, token, fetchImpl };
  try {
    switch (tool) {
      case 'spotify_playback':
        return await playback(input, context);
      case 'spotify_devices':
        return await devices(input, context);
      case 'spotify_queue':
        return await queue(input, context);
      case 'spotify_search':
        return await search(input, context);
      case 'spotify_playlists':
        return await playlists(input, context);
      case 'spotify_albums':
        return await albums(input, context);
      case 'spotify_library':
        return await library(input, context);
    }
  } catch (error) {
    return failure(tool, error instanceof Error ? error.message : String(error));
  }
}

async function playback(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const action = requiredAction(input, [
    'get_state',
    'get_currently_playing',
    'play',
    'pause',
    'next',
    'previous',
    'seek',
    'set_repeat',
    'set_shuffle',
    'set_volume',
    'recently_played',
  ]);
  const deviceId = optionalString(input, 'device_id');

  if (action === 'get_state') {
    const path = '/me/player';
    const result = await spotifyRequest({
      ...context,
      method: 'GET',
      path,
      query: { market: optionalString(input, 'market') },
      emptyResponse: {
        status_code: 204,
        empty: true,
        message: 'No active Spotify playback session was found.',
      },
    });
    return success('spotify_playback', action, normalizeEmptyPlayback(result, action), 'GET', path);
  }

  if (action === 'get_currently_playing') {
    const path = '/me/player/currently-playing';
    const result = await spotifyRequest({
      ...context,
      method: 'GET',
      path,
      query: { market: optionalString(input, 'market') },
      emptyResponse: {
        status_code: 204,
        empty: true,
        message: 'Spotify is not currently playing anything.',
      },
    });
    return success('spotify_playback', action, normalizeEmptyPlayback(result, action), 'GET', path);
  }

  if (action === 'play') {
    const path = '/me/player/play';
    const contextUri = input.context_uri
      ? normalizeSpotifyUri(String(input.context_uri), inferContextType(String(input.context_uri)))
      : undefined;
    const uris = input.uris ? normalizeSpotifyUris(asStringList(input.uris), 'track') : undefined;
    const result = await spotifyRequest({
      ...context,
      method: 'PUT',
      path,
      query: { device_id: deviceId },
      body: {
        context_uri: contextUri,
        uris,
        offset: isPlainRecord(input.offset) ? stripNil(input.offset) : undefined,
        position_ms: optionalInteger(input, 'position_ms'),
      },
    });
    return success('spotify_playback', action, result, 'PUT', path);
  }

  if (action === 'pause') {
    const path = '/me/player/pause';
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({ ...context, method: 'PUT', path, query: { device_id: deviceId } }),
      'PUT',
      path,
    );
  }

  if (action === 'next' || action === 'previous') {
    const path = `/me/player/${action}`;
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({ ...context, method: 'POST', path, query: { device_id: deviceId } }),
      'POST',
      path,
    );
  }

  if (action === 'seek') {
    const positionMs = requiredInteger(input, 'position_ms');
    const path = '/me/player/seek';
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({
        ...context,
        method: 'PUT',
        path,
        query: { position_ms: positionMs, device_id: deviceId },
      }),
      'PUT',
      path,
    );
  }

  if (action === 'set_repeat') {
    const state = optionalString(input, 'state')?.toLowerCase();
    if (!state || !REPEAT_STATES.has(state)) {
      throw new Error('state must be one of: track, context, off');
    }
    const path = '/me/player/repeat';
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({ ...context, method: 'PUT', path, query: { state, device_id: deviceId } }),
      'PUT',
      path,
    );
  }

  if (action === 'set_shuffle') {
    const path = '/me/player/shuffle';
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({
        ...context,
        method: 'PUT',
        path,
        query: { state: coerceBoolean(input.state), device_id: deviceId },
      }),
      'PUT',
      path,
    );
  }

  if (action === 'set_volume') {
    const volume = Math.max(0, Math.min(100, requiredInteger(input, 'volume_percent')));
    const path = '/me/player/volume';
    return success(
      'spotify_playback',
      action,
      await spotifyRequest({
        ...context,
        method: 'PUT',
        path,
        query: { volume_percent: volume, device_id: deviceId },
      }),
      'PUT',
      path,
    );
  }

  const after = optionalInteger(input, 'after');
  const before = optionalInteger(input, 'before');
  if (after !== undefined && before !== undefined) {
    throw new Error("Provide only one of 'after' or 'before'");
  }
  const path = '/me/player/recently-played';
  return success(
    'spotify_playback',
    action,
    await spotifyRequest({
      ...context,
      method: 'GET',
      path,
      query: {
        limit: coerceLimit(input.limit, 20),
        after,
        before,
      },
    }),
    'GET',
    path,
  );
}

async function devices(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const action = requiredAction(input, ['list', 'transfer']);
  if (action === 'list') {
    const path = '/me/player/devices';
    return success(
      'spotify_devices',
      action,
      await spotifyRequest({ ...context, method: 'GET', path }),
      'GET',
      path,
    );
  }
  const deviceId = requiredString(input, 'device_id');
  const path = '/me/player';
  return success(
    'spotify_devices',
    action,
    await spotifyRequest({
      ...context,
      method: 'PUT',
      path,
      body: { device_ids: [deviceId], play: coerceBoolean(input.play) },
    }),
    'PUT',
    path,
  );
}

async function queue(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const action = requiredAction(input, ['get', 'add']);
  const path = '/me/player/queue';
  if (action === 'get') {
    return success(
      'spotify_queue',
      action,
      await spotifyRequest({ ...context, method: 'GET', path }),
      'GET',
      path,
    );
  }
  const uri = normalizeSpotifyUri(requiredString(input, 'uri'));
  return success(
    'spotify_queue',
    action,
    await spotifyRequest({
      ...context,
      method: 'POST',
      path,
      query: { uri, device_id: optionalString(input, 'device_id') },
    }),
    'POST',
    path,
  );
}

async function search(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const query = requiredString(input, 'query');
  const requestedTypes = asStringList(input.types ?? input.type ?? ['track'])
    .map((value) => value.toLowerCase())
    .filter((value) => SEARCH_TYPES.has(value));
  if (requestedTypes.length === 0) {
    throw new Error('types must contain one or more of: album, artist, playlist, track, show, episode, audiobook');
  }
  const path = '/search';
  return success(
    'spotify_search',
    'search',
    await spotifyRequest({
      ...context,
      method: 'GET',
      path,
      query: {
        q: query,
        type: requestedTypes.join(','),
        limit: coerceLimit(input.limit, 10),
        offset: Math.max(0, optionalInteger(input, 'offset') ?? 0),
        market: optionalString(input, 'market'),
        include_external: optionalString(input, 'include_external'),
      },
    }),
    'GET',
    path,
  );
}

async function playlists(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const action = requiredAction(input, ['list', 'get', 'create', 'add_items', 'remove_items', 'update_details']);
  if (action === 'list') {
    const path = '/me/playlists';
    return success(
      'spotify_playlists',
      action,
      await spotifyRequest({
        ...context,
        method: 'GET',
        path,
        query: { limit: coerceLimit(input.limit, 20), offset: Math.max(0, optionalInteger(input, 'offset') ?? 0) },
      }),
      'GET',
      path,
    );
  }

  if (action === 'create') {
    const path = '/me/playlists';
    return success(
      'spotify_playlists',
      action,
      await spotifyRequest({
        ...context,
        method: 'POST',
        path,
        body: {
          name: requiredString(input, 'name'),
          public: coerceBoolean(input.public),
          collaborative: coerceBoolean(input.collaborative),
          description: optionalString(input, 'description'),
        },
      }),
      'POST',
      path,
    );
  }

  const playlistId = normalizeSpotifyId(requiredString(input, 'playlist_id'), 'playlist');
  if (action === 'get') {
    const path = `/playlists/${encodeURIComponent(playlistId)}`;
    return success(
      'spotify_playlists',
      action,
      await spotifyRequest({ ...context, method: 'GET', path, query: { market: optionalString(input, 'market') } }),
      'GET',
      path,
    );
  }

  if (action === 'add_items') {
    const path = `/playlists/${encodeURIComponent(playlistId)}/items`;
    return success(
      'spotify_playlists',
      action,
      await spotifyRequest({
        ...context,
        method: 'POST',
        path,
        body: {
          uris: normalizeSpotifyUris(asStringList(input.uris)),
          position: optionalInteger(input, 'position'),
        },
      }),
      'POST',
      path,
    );
  }

  if (action === 'remove_items') {
    const path = `/playlists/${encodeURIComponent(playlistId)}/items`;
    return success(
      'spotify_playlists',
      action,
      await spotifyRequest({
        ...context,
        method: 'DELETE',
        path,
        body: {
          items: normalizeSpotifyUris(asStringList(input.uris)).map((uri) => ({ uri })),
          snapshot_id: optionalString(input, 'snapshot_id'),
        },
      }),
      'DELETE',
      path,
    );
  }

  const path = `/playlists/${encodeURIComponent(playlistId)}`;
  return success(
    'spotify_playlists',
    action,
    await spotifyRequest({
      ...context,
      method: 'PUT',
      path,
      body: {
        name: optionalString(input, 'name'),
        public: optionalBoolean(input, 'public'),
        collaborative: optionalBoolean(input, 'collaborative'),
        description: optionalString(input, 'description'),
      },
    }),
    'PUT',
    path,
  );
}

async function albums(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const action = requiredAction(input, ['get', 'tracks']);
  const albumId = normalizeSpotifyId(requiredString(input, input.album_id ? 'album_id' : 'id'), 'album');
  if (action === 'get') {
    const path = `/albums/${encodeURIComponent(albumId)}`;
    return success(
      'spotify_albums',
      action,
      await spotifyRequest({ ...context, method: 'GET', path, query: { market: optionalString(input, 'market') } }),
      'GET',
      path,
    );
  }
  const path = `/albums/${encodeURIComponent(albumId)}/tracks`;
  return success(
    'spotify_albums',
    action,
    await spotifyRequest({
      ...context,
      method: 'GET',
      path,
      query: {
        limit: coerceLimit(input.limit, 20),
        offset: Math.max(0, optionalInteger(input, 'offset') ?? 0),
        market: optionalString(input, 'market'),
      },
    }),
    'GET',
    path,
  );
}

async function library(
  input: Record<string, unknown>,
  context: Pick<SpotifyRequestOptions, 'baseUrl' | 'token' | 'fetchImpl'>,
): Promise<SpotifyToolExecutionResult> {
  const kind = optionalString(input, 'kind')?.toLowerCase();
  if (kind !== 'tracks' && kind !== 'albums') {
    throw new Error('kind must be one of: tracks, albums');
  }
  const action = requiredAction(input, ['list', 'save', 'remove']);
  const itemType = kind === 'tracks' ? 'track' : 'album';
  if (action === 'list') {
    const path = kind === 'tracks' ? '/me/tracks' : '/me/albums';
    return success(
      'spotify_library',
      action,
      await spotifyRequest({
        ...context,
        method: 'GET',
        path,
        query: {
          limit: coerceLimit(input.limit, 20),
          offset: Math.max(0, optionalInteger(input, 'offset') ?? 0),
          market: optionalString(input, 'market'),
        },
      }),
      'GET',
      path,
    );
  }

  if (action === 'save') {
    const path = '/me/library';
    const uris = normalizeSpotifyUris(asStringList(input.uris ?? input.items), itemType);
    return success(
      'spotify_library',
      action,
      await spotifyRequest({ ...context, method: 'PUT', path, query: { uris: uris.join(',') } }),
      'PUT',
      path,
    );
  }

  const path = '/me/library';
  const ids = asStringList(input.ids ?? input.items).map((item) => normalizeSpotifyId(item, itemType));
  if (ids.length === 0) {
    throw new Error("ids/items is required for action='remove'");
  }
  const uris = ids.map((id) => `spotify:${itemType}:${id}`);
  return success(
    'spotify_library',
    action,
    await spotifyRequest({ ...context, method: 'DELETE', path, query: { uris: uris.join(',') } }),
    'DELETE',
    path,
  );
}

async function spotifyRequest<T = unknown>(options: SpotifyRequestOptions): Promise<T> {
  const url = new URL(options.path, normalizeBaseUrl(options.baseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await options.fetchImpl(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    ...(options.body ? { body: JSON.stringify(stripNil(options.body)) } : {}),
  });
  const raw = await response.text();
  const parsed = raw ? parseJsonOrText(raw) : undefined;
  if (!response.ok) {
    throw new Error(friendlySpotifyError(response.status, parsed, options.path, response.headers.get('Retry-After')));
  }
  if (response.status === 204 || raw.length === 0) {
    return (options.emptyResponse ?? { success: true, status_code: response.status, empty: true }) as T;
  }
  return parsed as T;
}

function success(
  tool: SpotifyToolName,
  action: string,
  result: unknown,
  method: SpotifyHttpMethod,
  path: string,
): SpotifyToolExecutionResult {
  return {
    kind: `${tool}_result`,
    ok: true,
    tool,
    action,
    result,
    request: { method, path },
  };
}

function failure(tool: SpotifyToolName, error: string): SpotifyToolExecutionResult {
  return {
    kind: `${tool}_result`,
    ok: false,
    tool,
    error,
  };
}

function normalizeEmptyPlayback(payload: unknown, action: string): unknown {
  const record = asRecord(payload);
  if (record.empty !== true) {
    return payload;
  }
  if (action === 'get_currently_playing') {
    return {
      success: true,
      action,
      is_playing: false,
      status_code: record.status_code ?? 204,
      message: record.message ?? 'Spotify is not currently playing anything.',
    };
  }
  return {
    success: true,
    action,
    has_active_device: false,
    status_code: record.status_code ?? 204,
    message: record.message ?? 'No active Spotify playback session was found.',
  };
}

function requiredAction(input: Record<string, unknown>, allowed: string[]): string {
  const action = optionalString(input, 'action')?.toLowerCase();
  if (!action) {
    throw new Error('action is required');
  }
  if (!allowed.includes(action)) {
    throw new Error(`Unknown Spotify action: ${action}`);
  }
  return action;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${key} must be a number`);
  }
  return Math.trunc(numberValue);
}

function requiredInteger(input: Record<string, unknown>, key: string): number {
  const value = optionalInteger(input, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return coerceBoolean(value);
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(cleaned)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(cleaned)) {
      return false;
    }
  }
  return false;
}

function coerceLimit(value: unknown, defaultValue: number): number {
  const numberValue = Number(value ?? defaultValue);
  if (!Number.isFinite(numberValue)) {
    return defaultValue;
  }
  return Math.max(1, Math.min(50, Math.trunc(numberValue)));
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function inferContextType(value: string): 'album' | 'playlist' | 'artist' | undefined {
  if (value.startsWith('spotify:album:') || value.includes('/album/')) return 'album';
  if (value.startsWith('spotify:playlist:') || value.includes('/playlist/')) return 'playlist';
  if (value.startsWith('spotify:artist:') || value.includes('/artist/')) return 'artist';
  return undefined;
}

export function normalizeSpotifyId(value: string, expectedType?: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error('Spotify id/uri/url is required.');
  }
  if (cleaned.startsWith('spotify:')) {
    const parts = cleaned.split(':');
    if (parts.length >= 3) {
      const itemType = parts[1];
      if (expectedType && itemType !== expectedType) {
        throw new Error(`Expected a Spotify ${expectedType}, got ${itemType}.`);
      }
      return parts[2]!;
    }
  }
  if (cleaned.includes('open.spotify.com')) {
    const parsed = new URL(cleaned);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      const [itemType, itemId] = pathParts;
      if (expectedType && itemType !== expectedType) {
        throw new Error(`Expected a Spotify ${expectedType}, got ${itemType}.`);
      }
      return itemId!;
    }
  }
  return cleaned;
}

export function normalizeSpotifyUri(value: string, expectedType?: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error('Spotify URI/url/id is required.');
  }
  if (cleaned.startsWith('spotify:')) {
    if (expectedType) {
      const parts = cleaned.split(':');
      if (parts.length >= 3 && parts[1] !== expectedType) {
        throw new Error(`Expected a Spotify ${expectedType}, got ${parts[1]}.`);
      }
    }
    return cleaned;
  }
  const itemId = normalizeSpotifyId(cleaned, expectedType);
  const inferredType = inferSpotifyTypeFromUrl(cleaned);
  if (expectedType || inferredType) {
    return `spotify:${expectedType ?? inferredType}:${itemId}`;
  }
  return itemId;
}

export function normalizeSpotifyUris(values: string[], expectedType?: string): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    unique.add(normalizeSpotifyUri(value, expectedType));
  }
  if (unique.size === 0) {
    throw new Error('At least one Spotify item is required.');
  }
  return [...unique];
}

function friendlySpotifyError(status: number, parsed: unknown, path: string, retryAfter: string | null): string {
  const detail = extractErrorDetail(parsed).toLowerCase();
  const isPlaybackPath = path.startsWith('/me/player');
  if (status === 401) {
    return 'Spotify authentication failed or expired. Refresh SPOTIFY_ACCESS_TOKEN before retrying.';
  }
  if (status === 403) {
    if (isPlaybackPath) {
      return 'Spotify rejected this playback request. Playback control usually requires Spotify Premium and an active Spotify Connect device.';
    }
    if (detail.includes('scope') || detail.includes('permission')) {
      return 'Spotify rejected the request because the current auth scope is insufficient.';
    }
    return 'Spotify rejected the request. The account may not have permission for this action.';
  }
  if (status === 404) {
    return isPlaybackPath
      ? 'Spotify could not find an active playback device or player session for this request.'
      : 'Spotify resource not found.';
  }
  if (status === 429) {
    return `Spotify rate limit exceeded.${retryAfter ? ` Retry after ${retryAfter} seconds.` : ''}`;
  }
  return extractErrorDetail(parsed) || `Spotify API request failed with status ${status}.`;
}

function inferSpotifyTypeFromUrl(value: string): string | undefined {
  if (!value.includes('open.spotify.com')) {
    return undefined;
  }
  const parsed = new URL(value);
  return parsed.pathname.split('/').filter(Boolean)[0];
}

function extractErrorDetail(parsed: unknown): string {
  const record = asRecord(parsed);
  const error = record.error;
  if (typeof error === 'string') {
    return error;
  }
  const errorRecord = asRecord(error);
  if (typeof errorRecord.message === 'string') {
    return errorRecord.message;
  }
  if (typeof parsed === 'string') {
    return parsed;
  }
  return '';
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stripNil<T extends Record<string, unknown>>(payload: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}
