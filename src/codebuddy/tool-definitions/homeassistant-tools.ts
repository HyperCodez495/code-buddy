import type { CodeBuddyTool } from './types.js';

export const HA_LIST_ENTITIES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ha_list_entities',
    description: 'List Home Assistant entities, optionally filtered by domain or area.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: "Entity domain to filter by, such as 'light', 'switch', 'climate', or 'sensor'.",
        },
        area: {
          type: 'string',
          description: "Area or room name to filter by, such as 'living room' or 'kitchen'.",
        },
      },
      required: [],
    },
  },
};

export const HA_GET_STATE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ha_get_state',
    description: 'Get detailed state and attributes for one Home Assistant entity.',
    parameters: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'string',
          description: "Entity ID to query, such as 'light.living_room' or 'sensor.temperature'.",
        },
      },
      required: ['entity_id'],
    },
  },
};

export const HA_LIST_SERVICES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ha_list_services',
    description: 'List available Home Assistant services and their parameters.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: "Optional service domain filter, such as 'light', 'climate', or 'switch'.",
        },
      },
      required: [],
    },
  },
};

export const HA_CALL_SERVICE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ha_call_service',
    description: 'Call a Home Assistant service to control a device.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: "Service domain, such as 'light', 'switch', 'climate', or 'scene'.",
        },
        service: {
          type: 'string',
          description: "Service name, such as 'turn_on', 'turn_off', 'set_temperature', or 'toggle'.",
        },
        entity_id: {
          type: 'string',
          description: "Optional target entity ID; takes precedence over data.entity_id.",
        },
        data: {
          type: 'object',
          description: 'Optional service data object. A JSON string is also accepted at runtime.',
        },
      },
      required: ['domain', 'service'],
    },
  },
};

export const HOMEASSISTANT_TOOLS: CodeBuddyTool[] = [
  HA_LIST_ENTITIES_TOOL,
  HA_GET_STATE_TOOL,
  HA_LIST_SERVICES_TOOL,
  HA_CALL_SERVICE_TOOL,
];
