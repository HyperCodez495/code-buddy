import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import {
  HA_CALL_SERVICE_TOOL,
  HA_GET_STATE_TOOL,
  HA_LIST_ENTITIES_TOOL,
  HA_LIST_SERVICES_TOOL,
} from '../../codebuddy/tool-definitions/homeassistant-tools.js';
import {
  executeHomeAssistantTool,
  type HomeAssistantToolName,
  type HomeAssistantToolOptions,
} from '../homeassistant-tool.js';
import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

const TOOL_DEFINITIONS: Record<HomeAssistantToolName, CodeBuddyTool> = {
  ha_list_entities: HA_LIST_ENTITIES_TOOL,
  ha_get_state: HA_GET_STATE_TOOL,
  ha_list_services: HA_LIST_SERVICES_TOOL,
  ha_call_service: HA_CALL_SERVICE_TOOL,
};

export class HomeAssistantTool implements ITool {
  readonly name: HomeAssistantToolName;
  readonly description: string;

  constructor(
    name: HomeAssistantToolName,
    private readonly options: HomeAssistantToolOptions = {},
  ) {
    this.name = name;
    this.description = TOOL_DEFINITIONS[name].function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeHomeAssistantTool(this.name, input, this.options);
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
    if (this.name === 'ha_get_state' && typeof data.entity_id !== 'string') {
      errors.push('entity_id is required');
    }
    if (this.name === 'ha_call_service') {
      if (typeof data.domain !== 'string') errors.push('domain is required');
      if (typeof data.service !== 'string') errors.push('service is required');
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['homeassistant', 'home assistant', 'hass', 'smart home', 'entity', 'service', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createHomeAssistantTools(options: HomeAssistantToolOptions = {}): ITool[] {
  return [
    new HomeAssistantTool('ha_list_entities', options),
    new HomeAssistantTool('ha_get_state', options),
    new HomeAssistantTool('ha_list_services', options),
    new HomeAssistantTool('ha_call_service', options),
  ];
}
