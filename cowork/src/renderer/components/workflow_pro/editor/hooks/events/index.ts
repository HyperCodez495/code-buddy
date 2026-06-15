/**
 * Event Hooks Barrel Export
 *
 * Modular event handling hooks extracted from useWorkflowEvents.
 * Each hook handles a specific category of events for better maintainability.
 */

export { useClickHandlers, type UseClickHandlersOptions, type UseClickHandlersReturn } from './useClickHandlers';

export {
  useConnectionHandlers,
  type UseConnectionHandlersOptions,
  type UseConnectionHandlersReturn,
} from './useConnectionHandlers';

export { useDragDrop, type UseDragDropOptions, type UseDragDropReturn } from './useDragDrop';

export { useContextMenu, type UseContextMenuReturn } from './useContextMenu';

export { useKeyboardShortcuts, type UseKeyboardShortcutsOptions } from './useKeyboardShortcuts';

export { useWindowEvents, type UseWindowEventsOptions } from './useWindowEvents';
