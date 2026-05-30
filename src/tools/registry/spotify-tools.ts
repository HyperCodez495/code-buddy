import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import {
  SPOTIFY_ALBUMS_TOOL,
  SPOTIFY_DEVICES_TOOL,
  SPOTIFY_LIBRARY_TOOL,
  SPOTIFY_PLAYBACK_TOOL,
  SPOTIFY_PLAYLISTS_TOOL,
  SPOTIFY_QUEUE_TOOL,
  SPOTIFY_SEARCH_TOOL,
} from '../../codebuddy/tool-definitions/spotify-tools.js';
import {
  executeSpotifyTool,
  type SpotifyToolName,
  type SpotifyToolOptions,
} from '../spotify-tool.js';
import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

const TOOL_DEFINITIONS: Record<SpotifyToolName, CodeBuddyTool> = {
  spotify_playback: SPOTIFY_PLAYBACK_TOOL,
  spotify_devices: SPOTIFY_DEVICES_TOOL,
  spotify_queue: SPOTIFY_QUEUE_TOOL,
  spotify_search: SPOTIFY_SEARCH_TOOL,
  spotify_playlists: SPOTIFY_PLAYLISTS_TOOL,
  spotify_albums: SPOTIFY_ALBUMS_TOOL,
  spotify_library: SPOTIFY_LIBRARY_TOOL,
};

export class SpotifyTool implements ITool {
  readonly name: SpotifyToolName;
  readonly description: string;

  constructor(
    name: SpotifyToolName,
    private readonly options: SpotifyToolOptions = {},
  ) {
    this.name = name;
    this.description = TOOL_DEFINITIONS[name].function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeSpotifyTool(this.name, input, this.options);
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        data: result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: TOOL_DEFINITIONS[this.name].function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (this.name !== 'spotify_search' && typeof data.action !== 'string') {
      errors.push('action is required');
    }
    if (this.name === 'spotify_search' && typeof data.query !== 'string') {
      errors.push('query is required');
    }
    if (this.name === 'spotify_library') {
      if (typeof data.kind !== 'string') errors.push('kind is required');
      if (typeof data.action !== 'string') errors.push('action is required');
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['spotify', 'music', 'playback', 'playlist', 'album', 'library', 'queue', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSpotifyTools(options: SpotifyToolOptions = {}): ITool[] {
  return [
    new SpotifyTool('spotify_playback', options),
    new SpotifyTool('spotify_devices', options),
    new SpotifyTool('spotify_queue', options),
    new SpotifyTool('spotify_search', options),
    new SpotifyTool('spotify_playlists', options),
    new SpotifyTool('spotify_albums', options),
    new SpotifyTool('spotify_library', options),
  ];
}
