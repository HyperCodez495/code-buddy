import { describe, expect, it } from 'vitest';

import {
  FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT,
  buildHermesToolsetDescriptor,
  buildDispatchPolicyConfig,
  buildDispatchSystemPrompt,
  buildDispatchToolFilter,
  formatDispatchProfileSelectionGuide,
  getDispatchRunnableTools,
  getDispatchPolicyRules,
  getDispatchToolPolicy,
  mergeDispatchSystemPrompt,
  normalizeDispatchProfile,
  previewDispatchToolDecisions,
} from '../../src/fleet/dispatch-profile.js';
import { PolicyResolver } from '../../src/security/tool-policy/policy-resolver.js';

describe('Fleet dispatch profiles', () => {
  it('normalizes unknown profile input to balanced', () => {
    expect(normalizeDispatchProfile('code')).toBe('code');
    expect(normalizeDispatchProfile('unknown')).toBe('balanced');
    expect(normalizeDispatchProfile(undefined)).toBe('balanced');
  });

  it('exposes a canonical dispatch profile selection guide', () => {
    const guide = formatDispatchProfileSelectionGuide();

    expect(guide).toBe(FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT);
    expect(guide).toContain('balanced: general delegation');
    expect(guide).toContain('research: source-aware investigation');
    expect(guide).toContain('code: implementation');
    expect(guide).toContain('review: read-first code review');
    expect(guide).toContain('safe: high-risk');
  });

  it('maps review and safe profiles to restrictive tool policies', () => {
    const review = getDispatchToolPolicy('review');
    expect(review.policyProfile).toBe('minimal');
    expect(review.allowGroups).toContain('group:fs:read');
    expect(review.denyGroups).toContain('group:fs:write');
    expect(review.denyGroups).toContain('group:runtime');

    const safe = getDispatchToolPolicy('safe');
    expect(safe.defaultAction).toBe('deny');
    expect(safe.denyGroups).toContain('group:dangerous');
  });

  it('returns defensive copies of policy arrays', () => {
    const first = getDispatchToolPolicy('code');
    first.allowGroups.push('group:dangerous');

    const second = getDispatchToolPolicy('code');
    expect(second.allowGroups).not.toContain('group:dangerous');
  });

  it('injects tool policy hints into dispatch system prompts', () => {
    const prompt = buildDispatchSystemPrompt('review');
    expect(prompt).toContain('Prioritize defects');
    expect(prompt).toContain('Tool policy hint:');
    expect(prompt).toContain('read-first');
  });

  it('merges dispatch policy hints into custom peer prompts without duplication', () => {
    const prompt = mergeDispatchSystemPrompt('You are a pirate.', 'safe');

    expect(prompt).toContain('You are a pirate.');
    expect(prompt).toContain('protect secrets');
    expect(prompt).toContain('Tool policy hint:');
    expect(mergeDispatchSystemPrompt(prompt, 'safe')).toBe(prompt);
  });

  it('builds policy resolver rules from dispatch profile groups', () => {
    const rules = getDispatchPolicyRules('review');

    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'group:fs:write', action: 'deny' }),
        expect.objectContaining({ group: 'group:web:fetch', action: 'confirm' }),
        expect.objectContaining({ group: 'group:fs:read', action: 'allow' }),
      ]),
    );
  });

  it('enforces review as read-only through the policy resolver', () => {
    const resolver = new PolicyResolver(buildDispatchPolicyConfig('review'));

    expect(resolver.resolve('view_file').action).toBe('allow');
    expect(resolver.resolve('web_search').action).toBe('allow');
    expect(resolver.resolve('web_fetch').action).toBe('confirm');
    expect(resolver.resolve('create_file').action).toBe('deny');
    expect(resolver.resolve('bash').action).toBe('deny');
  });

  it('keeps code profile writable but confirms risky execution and git write', () => {
    const resolver = new PolicyResolver(buildDispatchPolicyConfig('code'));

    expect(resolver.resolve('view_file').action).toBe('allow');
    expect(resolver.resolve('create_file').action).toBe('allow');
    expect(resolver.resolve('bash').action).toBe('confirm');
    expect(resolver.resolve('git_push').action).toBe('confirm');
  });

  it('uses safe profile default deny for unknown tools', () => {
    const resolver = new PolicyResolver(buildDispatchPolicyConfig('safe'));

    expect(resolver.resolve('some_future_tool').action).toBe('deny');
  });

  it('previews and filters runnable tools for dispatch execution', () => {
    const tools = ['view_file', 'create_file', 'bash', 'web_fetch'];
    const reviewDecisions = previewDispatchToolDecisions('review', tools);

    expect(reviewDecisions).toEqual([
      expect.objectContaining({ tool: 'view_file', action: 'allow' }),
      expect.objectContaining({ tool: 'create_file', action: 'deny' }),
      expect.objectContaining({ tool: 'bash', action: 'deny' }),
      expect.objectContaining({ tool: 'web_fetch', action: 'confirm' }),
    ]);
    expect(getDispatchRunnableTools('review', tools)).toEqual(['view_file', 'web_fetch']);
    expect(getDispatchRunnableTools('code', tools)).toEqual(tools);
  });

  it('builds a ToolFilterConfig from Hermes dispatch policy decisions', () => {
    const tools = ['view_file', 'create_file', 'bash', 'web_fetch', 'some_future_tool'];

    expect(buildDispatchToolFilter('review', tools)).toEqual({
      enabledPatterns: ['view_file', 'web_fetch', 'some_future_tool'],
      disabledPatterns: ['create_file', 'bash'],
    });
    expect(buildDispatchToolFilter('safe', tools)).toEqual({
      enabledPatterns: ['view_file', 'web_fetch'],
      disabledPatterns: ['create_file', 'bash', 'some_future_tool'],
    });
  });

  it('builds Hermes-style toolset descriptors from dispatch policy decisions', () => {
    const toolset = buildHermesToolsetDescriptor('review', [
      'view_file',
      'create_file',
      'bash',
      'web_fetch',
    ]);

    expect(toolset.toolsetId).toBe('fleet.hermes.review');
    expect(toolset.label).toContain('Hermes-style Fleet review toolset');
    expect(toolset.allowedTools).toEqual(['view_file']);
    expect(toolset.confirmTools).toEqual(['web_fetch']);
    expect(toolset.deniedTools).toEqual(['create_file', 'bash']);
    expect(toolset.decisions).toEqual([
      expect.objectContaining({ tool: 'view_file', action: 'allow' }),
      expect.objectContaining({ tool: 'create_file', action: 'deny' }),
      expect.objectContaining({ tool: 'bash', action: 'deny' }),
      expect.objectContaining({ tool: 'web_fetch', action: 'confirm' }),
    ]);
    expect(toolset.systemPrompt).toContain('Prioritize defects');
  });

  it('keeps safe Hermes-style toolsets closed to unknown tools', () => {
    const toolset = buildHermesToolsetDescriptor('safe', ['some_future_tool']);

    expect(toolset.defaultAction).toBe('deny');
    expect(toolset.allowedTools).toEqual([]);
    expect(toolset.confirmTools).toEqual([]);
    expect(toolset.deniedTools).toEqual(['some_future_tool']);
  });
});
