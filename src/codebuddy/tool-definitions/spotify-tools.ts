import type { CodeBuddyTool } from './types.js';

const COMMON_STRING = { type: 'string' };

export const SPOTIFY_PLAYBACK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_playback',
    description: 'Control Spotify playback, inspect the active playback state, or fetch recently played tracks.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
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
          ],
        },
        device_id: COMMON_STRING,
        market: COMMON_STRING,
        context_uri: COMMON_STRING,
        uris: { type: 'array', items: COMMON_STRING },
        offset: { type: 'object' },
        position_ms: { type: 'integer' },
        state: {
          type: 'string',
          description: 'For set_repeat use track/context/off. For set_shuffle use boolean-like true/false.',
        },
        volume_percent: { type: 'integer' },
        limit: { type: 'integer', description: 'For recently_played: number of tracks, max 50.' },
        after: { type: 'integer', description: 'For recently_played: Unix ms cursor after this timestamp.' },
        before: { type: 'integer', description: 'For recently_played: Unix ms cursor before this timestamp.' },
      },
      required: ['action'],
    },
  },
};

export const SPOTIFY_DEVICES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_devices',
    description: 'List Spotify Connect devices or transfer playback to a different device.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'transfer'] },
        device_id: COMMON_STRING,
        play: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
};

export const SPOTIFY_QUEUE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_queue',
    description: "Inspect the user's Spotify queue or add an item to it.",
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'add'] },
        uri: COMMON_STRING,
        device_id: COMMON_STRING,
      },
      required: ['action'],
    },
  },
};

export const SPOTIFY_SEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_search',
    description: 'Search the Spotify catalog for tracks, albums, artists, playlists, shows, episodes, or audiobooks.',
    parameters: {
      type: 'object',
      properties: {
        query: COMMON_STRING,
        types: { type: 'array', items: COMMON_STRING },
        type: COMMON_STRING,
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        market: COMMON_STRING,
        include_external: COMMON_STRING,
      },
      required: ['query'],
    },
  },
};

export const SPOTIFY_PLAYLISTS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_playlists',
    description: 'List, inspect, create, update, and modify Spotify playlists.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'add_items', 'remove_items', 'update_details'],
        },
        playlist_id: COMMON_STRING,
        market: COMMON_STRING,
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        name: COMMON_STRING,
        description: COMMON_STRING,
        public: { type: 'boolean' },
        collaborative: { type: 'boolean' },
        uris: { type: 'array', items: COMMON_STRING },
        position: { type: 'integer' },
        snapshot_id: COMMON_STRING,
      },
      required: ['action'],
    },
  },
};

export const SPOTIFY_ALBUMS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_albums',
    description: 'Fetch Spotify album metadata or album tracks.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'tracks'] },
        album_id: COMMON_STRING,
        id: COMMON_STRING,
        market: COMMON_STRING,
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      required: ['action'],
    },
  },
};

export const SPOTIFY_LIBRARY_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spotify_library',
    description: "List, save, or remove the user's saved Spotify tracks or albums. Use kind to select which.",
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['tracks', 'albums'],
          description: 'Which library to operate on.',
        },
        action: { type: 'string', enum: ['list', 'save', 'remove'] },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        market: COMMON_STRING,
        uris: { type: 'array', items: COMMON_STRING },
        ids: { type: 'array', items: COMMON_STRING },
        items: { type: 'array', items: COMMON_STRING },
      },
      required: ['kind', 'action'],
    },
  },
};

export const SPOTIFY_TOOLS: CodeBuddyTool[] = [
  SPOTIFY_PLAYBACK_TOOL,
  SPOTIFY_DEVICES_TOOL,
  SPOTIFY_QUEUE_TOOL,
  SPOTIFY_SEARCH_TOOL,
  SPOTIFY_PLAYLISTS_TOOL,
  SPOTIFY_ALBUMS_TOOL,
  SPOTIFY_LIBRARY_TOOL,
];
