import { describe, it, expect, vi } from 'vitest';

import {
  CoworkMcpOAuthProvider,
  createOAuthCallbackListener,
  type McpOAuthPersistedState,
} from '../src/main/mcp/mcp-oauth';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const sampleTokens: OAuthTokens = {
  access_token: 'access-123',
  token_type: 'Bearer',
  refresh_token: 'refresh-456',
} as OAuthTokens;

describe('CoworkMcpOAuthProvider', () => {
  it('persists tokens via saveState and restores them via loadState', () => {
    let saved: McpOAuthPersistedState | undefined;
    const provider = new CoworkMcpOAuthProvider({
      openExternal: vi.fn(),
      loadState: () => undefined,
      saveState: (s) => {
        saved = s;
      },
    });

    expect(provider.tokens()).toBeUndefined();
    provider.saveTokens(sampleTokens);
    expect(provider.tokens()).toEqual(sampleTokens);
    expect(saved?.tokens).toEqual(sampleTokens);

    // A new provider with loadState returning the persisted blob restores tokens.
    const restored = new CoworkMcpOAuthProvider({
      openExternal: vi.fn(),
      loadState: () => saved,
      saveState: vi.fn(),
    });
    expect(restored.tokens()).toEqual(sampleTokens);
  });

  it('clears tokens (and persists the clear) on invalidateCredentials', () => {
    let saved: McpOAuthPersistedState | undefined = { tokens: sampleTokens };
    const provider = new CoworkMcpOAuthProvider({
      openExternal: vi.fn(),
      loadState: () => saved,
      saveState: (s) => {
        saved = s;
      },
    });
    expect(provider.tokens()).toEqual(sampleTokens);
    provider.invalidateCredentials('tokens');
    expect(provider.tokens()).toBeUndefined();
    expect(saved?.tokens).toBeUndefined();
  });

  it('round-trips the PKCE code verifier and opens the browser for authorization', () => {
    const openExternal = vi.fn();
    const provider = new CoworkMcpOAuthProvider({ openExternal });

    expect(() => provider.codeVerifier()).toThrow();
    provider.saveCodeVerifier('verifier-xyz');
    expect(provider.codeVerifier()).toBe('verifier-xyz');

    provider.redirectToAuthorization(new URL('https://auth.example.com/authorize?x=1'));
    expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize?x=1');
  });

  it('rebuilds client metadata for a new redirect URL', () => {
    const provider = new CoworkMcpOAuthProvider({ openExternal: vi.fn() });
    provider.setRedirectUrl('http://127.0.0.1:5555/callback');
    expect(provider.clientMetadata.redirect_uris).toContain('http://127.0.0.1:5555/callback');
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe('none');
    expect(provider.clientMetadata.grant_types).toContain('authorization_code');
  });
});

describe('createOAuthCallbackListener', () => {
  it('serves a loopback redirect URL and resolves waitForCode when the code arrives', async () => {
    const listener = await createOAuthCallbackListener(5000);
    try {
      expect(listener.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const codePromise = listener.waitForCode();

      // Simulate the browser redirect hitting the loopback listener.
      const res = await fetch(`${listener.redirectUrl}?code=auth-code-789`);
      expect(res.status).toBe(200);
      await res.text().catch(() => {}); // drain body so the connection closes cleanly

      await expect(codePromise).resolves.toBe('auth-code-789');
    } finally {
      await listener.close();
    }
  });

  it('rejects waitForCode when the provider returns an error', async () => {
    const listener = await createOAuthCallbackListener(5000);
    try {
      const codePromise = listener.waitForCode();
      // Attach the rejection expectation BEFORE the fetch so the handler is in
      // place when the callback rejects (avoids a transient unhandled rejection).
      const expectation = expect(codePromise).rejects.toThrow(/access_denied|nope/);
      const res = await fetch(`${listener.redirectUrl}?error=access_denied&error_description=nope`);
      await res.text().catch(() => {}); // drain body so the connection closes cleanly
      await expectation;
    } finally {
      await listener.close();
    }
  });
});
