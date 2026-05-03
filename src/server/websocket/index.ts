/**
 * WebSocket Module
 *
 * Exports WebSocket handler and utilities.
 */

export {
  setupWebSocket,
  getConnectionCount,
  getConnectionStats,
  broadcast,
  closeAllConnections,
} from './handler.js';

// Phase (d).1 V0.4.1 — fleet event broadcast for inter-Claude streaming
export {
  broadcastFleetEvent,
  setFleetEventSource,
  FLEET_EVENT_TYPES,
  type FleetEventType,
  type FleetEventSource,
} from './fleet-bridge.js';
