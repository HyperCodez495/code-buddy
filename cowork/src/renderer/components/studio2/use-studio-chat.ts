import { useCallback } from 'react';
import { parseEditIntent, type EditIntent } from './utils/edit-intent.js';
export interface StudioChatBridgeApi { sendEditIntent: (intent: EditIntent) => void | Promise<void>; }
export function useStudioChat(api: StudioChatBridgeApi) { return useCallback((text: string) => api.sendEditIntent(parseEditIntent(text)), [api]); }
