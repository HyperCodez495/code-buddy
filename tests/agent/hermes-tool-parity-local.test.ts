import { describe, expect, it } from 'vitest';

import {
  buildLocalHermesToolParityManifest,
  collectOfflineBuiltinTools,
} from '../../src/agent/hermes-tool-parity-local.js';

describe('local Hermes tool parity manifest', () => {
  it('builds the official Hermes catalog from real built-in Code Buddy tools', () => {
    const tools = collectOfflineBuiltinTools();
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T16:30:00.000Z');

    expect(tools.length).toBeGreaterThan(100);
    expect(manifest.kind).toBe('hermes_official_tool_parity_manifest');
    expect(manifest.summary.total).toBe(71);
    expect(manifest.codeBuddySource.localToolCount).toBe(tools.length);
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'execute_code',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['execute_code']),
      }),
      expect.objectContaining({
        name: 'vision_analyze',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['vision_analyze']),
      }),
      expect.objectContaining({
        name: 'browser_vision',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['browser_vision']),
      }),
      expect.objectContaining({
        name: 'text_to_speech',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['text_to_speech']),
      }),
      expect.objectContaining({
        name: 'kanban_show',
        status: 'exact',
        detectedCodeBuddyTools: ['kanban_show'],
      }),
      expect.objectContaining({
        name: 'kanban_create',
        status: 'exact',
        detectedCodeBuddyTools: ['kanban_create'],
      }),
      expect.objectContaining({
        name: 'send_message',
        status: 'exact',
        detectedCodeBuddyTools: ['send_message'],
      }),
      expect.objectContaining({
        name: 'discord',
        status: 'exact',
        detectedCodeBuddyTools: ['discord'],
      }),
      expect.objectContaining({
        name: 'ha_list_entities',
        status: 'exact',
        detectedCodeBuddyTools: ['ha_list_entities'],
      }),
      expect.objectContaining({
        name: 'ha_get_state',
        status: 'exact',
        detectedCodeBuddyTools: ['ha_get_state'],
      }),
      expect.objectContaining({
        name: 'ha_list_services',
        status: 'exact',
        detectedCodeBuddyTools: ['ha_list_services'],
      }),
      expect.objectContaining({
        name: 'ha_call_service',
        status: 'exact',
        detectedCodeBuddyTools: ['ha_call_service'],
      }),
      expect.objectContaining({
        name: 'mixture_of_agents',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['mixture_of_agents']),
      }),
      expect.objectContaining({
        name: 'spotify_playback',
        status: 'exact',
        detectedCodeBuddyTools: ['spotify_playback'],
      }),
      expect.objectContaining({
        name: 'spotify_search',
        status: 'exact',
        detectedCodeBuddyTools: ['spotify_search'],
      }),
      expect.objectContaining({
        name: 'spotify_library',
        status: 'exact',
        detectedCodeBuddyTools: ['spotify_library'],
      }),
      expect.objectContaining({
        name: 'x_search',
        status: 'exact',
        detectedCodeBuddyTools: ['x_search'],
      }),
      expect.objectContaining({
        name: 'feishu_doc_read',
        status: 'exact',
        detectedCodeBuddyTools: ['feishu_doc_read'],
      }),
      expect.objectContaining({
        name: 'feishu_drive_reply_comment',
        status: 'exact',
        detectedCodeBuddyTools: ['feishu_drive_reply_comment'],
      }),
    ]));
  });
});
