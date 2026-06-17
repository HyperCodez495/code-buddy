/**
 * Tests for src/providers/xai-oauth.ts.
 *
 * Covers the offline-testable parts of the xAI / Grok OAuth flow: PKCE
 * generation shape, authorize URL contract, OIDC endpoint validation, and
 * JWT-based expiry detection. The interactive `loginInteractive()` needs a
 * real browser + an entitled xAI subscription, so it's exercised manually.
 */

import { describe, it, expect } from 'vitest';
import { __test } from '../../src/providers/xai-oauth.js';

/** Build a minimal unsigned JWT with the given claims (header.payload.sig). */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

describe('xai-oauth — PKCE generation', () => {
  it('produces URL-safe base64 verifier/challenge with no padding', () => {
    const { code_verifier, code_challenge } = __test.generatePkce();
    expect(code_verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code_verifier).not.toContain('=');
  });

  it('verifier encodes 64 bytes → 86 base64url chars', () => {
    const { code_verifier } = __test.generatePkce();
    expect(code_verifier).toHaveLength(86);
  });

  it('produces a different pair each call', () => {
    expect(__test.generatePkce().code_verifier).not.toBe(__test.generatePkce().code_verifier);
  });
});

describe('xai-oauth — authorize URL contract', () => {
  const url = () =>
    new URL(
      __test.buildAuthorizeUrl(
        __test.FALLBACK_AUTHORIZE_ENDPOINT,
        'http://127.0.0.1:56121/callback',
        'CHALLENGE',
        'STATE123',
        'NONCE456'
      )
    );

  it('targets the xAI authorize endpoint', () => {
    expect(url().origin + url().pathname).toBe(__test.FALLBACK_AUTHORIZE_ENDPOINT);
  });

  it('carries the Grok CLI client_id, PKCE, state, nonce and attribution', () => {
    const p = url().searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe(__test.CLIENT_ID);
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:56121/callback');
    expect(p.get('scope')).toBe(__test.SCOPES);
    expect(p.get('code_challenge')).toBe('CHALLENGE');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('STATE123');
    expect(p.get('nonce')).toBe('NONCE456');
    expect(p.get('plan')).toBe('generic');
    expect(p.get('referrer')).toBe('code-buddy');
  });

  it('requests the api:access scope (the inference entitlement)', () => {
    expect(__test.SCOPES).toContain('api:access');
    expect(__test.SCOPES).toContain('offline_access');
  });
});

describe('xai-oauth — OIDC endpoint validation', () => {
  it('accepts https endpoints on the x.ai origin', () => {
    expect(__test.isXaiHttpsEndpoint('https://auth.x.ai/oauth2/token')).toBe(true);
    expect(__test.isXaiHttpsEndpoint('https://x.ai/oauth/authorize')).toBe(true);
  });

  it('rejects non-https, foreign-host, and malformed endpoints', () => {
    expect(__test.isXaiHttpsEndpoint('http://auth.x.ai/oauth2/token')).toBe(false);
    expect(__test.isXaiHttpsEndpoint('https://evil.com/token')).toBe(false);
    expect(__test.isXaiHttpsEndpoint('https://auth.x.ai.evil.com/token')).toBe(false);
    expect(__test.isXaiHttpsEndpoint('not a url')).toBe(false);
  });
});

describe('xai-oauth — pasted callback parsing', () => {
  it('accepts a bare authorization code (xAI in-page code, no state)', () => {
    const parsed = __test.parsePastedCallback('  zCKD6-BTHkPSJXDQy_ABC  ');
    expect(parsed).toEqual({ code: 'zCKD6-BTHkPSJXDQy_ABC' });
  });

  it('extracts code + state from a full callback URL', () => {
    const parsed = __test.parsePastedCallback(
      'http://127.0.0.1:56121/callback?code=THECODE&state=THESTATE'
    );
    expect(parsed).toEqual({ code: 'THECODE', state: 'THESTATE' });
  });

  it('extracts code from a bare query fragment', () => {
    expect(__test.parsePastedCallback('?code=XYZ&state=S1')).toEqual({ code: 'XYZ', state: 'S1' });
  });

  it('returns null for empty input', () => {
    expect(__test.parsePastedCallback('   ')).toBeNull();
  });
});

describe('xai-oauth — JWT expiry', () => {
  it('decodes JWT claims and returns null for opaque tokens', () => {
    const jwt = fakeJwt({ email: 'a@b.co', exp: 1234 });
    expect(__test.decodeJwtClaims(jwt)).toMatchObject({ email: 'a@b.co', exp: 1234 });
    expect(__test.decodeJwtClaims('opaque-token')).toBeNull();
  });

  it('computes positive TTL for a future-dated JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const ttl = __test.accessTokenTtlSeconds(fakeJwt({ exp }));
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('returns null TTL for opaque tokens (no exp claim)', () => {
    expect(__test.accessTokenTtlSeconds('opaque')).toBeNull();
  });

  it('flags a JWT inside the refresh-skew window as expiring', () => {
    const soon = Math.floor(Date.now() / 1000) + 30; // within 120s skew
    expect(__test.isAccessTokenExpiring(fakeJwt({ exp: soon }))).toBe(true);
  });

  it('does NOT flag a long-lived JWT as expiring', () => {
    const later = Math.floor(Date.now() / 1000) + 3600;
    expect(__test.isAccessTokenExpiring(fakeJwt({ exp: later }))).toBe(false);
  });

  it('treats opaque tokens as not-expiring (reactive refresh only)', () => {
    expect(__test.isAccessTokenExpiring('opaque-token')).toBe(false);
  });
});
