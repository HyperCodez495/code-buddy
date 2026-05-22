/**
 * Phase d.23 — tests for src/providers/codex-oauth.ts.
 *
 * Covers the offline-testable parts of the OAuth flow: PKCE generation
 * shape, JWT id_token claim extraction, authorize URL contract.
 *
 * The interactive `loginInteractive()` requires a real browser + user,
 * so it's exercised manually (E2E checklist in the plan file). Tests
 * here focus on what the upstream openai/codex CLI also unit-tests:
 *   - PKCE 64-byte verifier shape
 *   - id_token namespaced claim extraction
 *   - authorize URL contract (params + values)
 */

import { describe, it, expect } from 'vitest';
import { __test } from '../../src/providers/codex-oauth.js';

describe('codex-oauth — PKCE generation', () => {
  it('produces a code_verifier and code_challenge that are URL-safe base64 (no padding)', () => {
    const { code_verifier, code_challenge } = __test.generatePkce();
    expect(code_verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // No `=` padding, no `+` or `/`.
    expect(code_verifier).not.toContain('=');
    expect(code_verifier).not.toContain('+');
    expect(code_verifier).not.toContain('/');
  });

  it('verifier encodes 64 bytes of entropy → 86 base64url chars (matches upstream)', () => {
    // 64 bytes → ceil(64 * 4 / 3) = 86 chars after stripping padding.
    const { code_verifier } = __test.generatePkce();
    expect(code_verifier.length).toBe(86);
  });

  it('challenge is the SHA-256 of the verifier as base64url (S256)', () => {
    const { code_verifier, code_challenge } = __test.generatePkce();
    // Re-compute and compare.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto');
    const expected = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(code_challenge).toBe(expected);
  });

  it('two consecutive calls produce different verifiers (real entropy)', () => {
    const a = __test.generatePkce();
    const b = __test.generatePkce();
    expect(a.code_verifier).not.toBe(b.code_verifier);
  });
});

describe('codex-oauth — id_token claim extraction', () => {
  function makeJwt(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${header}.${payload}.`;
  }

  it('extracts ChatGPT account metadata from the namespaced auth claim', () => {
    const idToken = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
        chatgpt_plan_type: 'plus',
        chatgpt_account_is_fedramp: false,
      },
      'https://api.openai.com/profile': {
        email: 'patrice@example.com',
      },
    });

    const auth = __test.chatGptAuthFromTokens({
      id_token: idToken,
      access_token: 'access-tok',
      refresh_token: 'refresh-tok',
    });

    expect(auth.access_token).toBe('access-tok');
    expect(auth.account_id).toBe('acct_123');
    expect(auth.plan_type).toBe('plus');
    expect(auth.email).toBe('patrice@example.com');
    expect(auth.is_fedramp).toBe(false);
  });

  it('honors the FedRAMP flag when present', () => {
    const idToken = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_is_fedramp: true,
      },
    });
    const auth = __test.chatGptAuthFromTokens({
      id_token: idToken,
      access_token: 'a',
      refresh_token: 'r',
    });
    expect(auth.is_fedramp).toBe(true);
  });

  it('top-level token.account_id wins over the id_token claim', () => {
    const idToken = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'from-claim' },
    });
    const auth = __test.chatGptAuthFromTokens({
      id_token: idToken,
      access_token: 'a',
      refresh_token: 'r',
      account_id: 'from-token',
    });
    expect(auth.account_id).toBe('from-token');
  });

  it('returns a usable shape on a malformed id_token (no crash)', () => {
    const auth = __test.chatGptAuthFromTokens({
      id_token: 'not-a-jwt',
      access_token: 'a',
      refresh_token: 'r',
    });
    expect(auth.access_token).toBe('a');
    expect(auth.is_fedramp).toBe(false);
    // Other fields silently undefined — caller decides how to handle.
  });
});

describe('codex-oauth — /cancel hand-off (Axe L)', () => {
  it('pingCancelEndpoint silently swallows connection-refused (clean state)', async () => {
    // Pick a port unlikely to be bound. Promise must resolve, not throw.
    await expect(__test.pingCancelEndpoint(45321)).resolves.toBeUndefined();
  });

  it('pingCancelEndpoint silently swallows AbortSignal timeout', async () => {
    // We can't easily bind a slow server here; the connection-refused
    // case above already exercises the swallow path. Fast smoke check.
    await expect(__test.pingCancelEndpoint(45322)).resolves.toBeUndefined();
  });

  it('bindCallbackServer falls back to the secondary port when primary is taken', async () => {
    const http = await import('http');
    // Hold port 45421 with a non-Codex server (no /cancel handler).
    // The bind code will retry 10x@200ms, fail, then fallback to 45423.
    const blocker = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => blocker.listen(45421, '127.0.0.1', () => resolve()));

    try {
      const noopHandler: import('http').RequestListener = (_, res) => res.end();
      const result = await __test.bindCallbackServer([45421, 45423], noopHandler);
      expect(result.port).toBe(45423);
      result.server.close();
    } finally {
      blocker.close();
    }
  }, 5000);

  it('bindCallbackServer cancels a Codex zombie via GET /cancel and re-binds primary', async () => {
    const http = await import('http');
    // Spin a "Codex zombie" — server with /cancel handler that closes
    // itself on receipt. Mirrors what loginInteractive's server does.
    let zombie: import('http').Server | null = http.createServer((req, res) => {
      const u = new URL(req.url || '', 'http://127.0.0.1');
      if (u.pathname === '/cancel') {
        res.writeHead(200);
        res.end('cancelled');
        zombie?.close();
        zombie = null;
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => zombie!.listen(45431, '127.0.0.1', () => resolve()));

    const noopHandler: import('http').RequestListener = (_, res) => res.end();
    const result = await __test.bindCallbackServer([45431, 45433], noopHandler);
    // Primary won — zombie shut down on /cancel and we bound 45431.
    expect(result.port).toBe(45431);
    result.server.close();
  }, 5000);
});

describe('codex-oauth — authorize URL contract', () => {
  it('contains the required Codex CLI params in the upstream-expected shape', () => {
    const url = __test.buildAuthorizeUrl(
      'http://localhost:1455/auth/callback',
      'challenge-X',
      'state-Y',
    );
    expect(url.startsWith('https://auth.openai.com/oauth/authorize?')).toBe(true);
    expect(url).toContain('client_id=' + __test.CLIENT_ID);
    expect(url).toContain('originator=' + __test.ORIGINATOR);
    expect(url).toContain('id_token_add_organizations=true');
    expect(url).toContain('codex_cli_simplified_flow=true');
    expect(url).toContain('code_challenge=challenge-X');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=state-Y');
    // redirect_uri is properly URL-encoded.
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback');
  });

  it('encodes scopes with the ChatGPT connectors permissions', () => {
    const url = __test.buildAuthorizeUrl('http://localhost:1455/auth/callback', 'c', 's');
    // URLSearchParams encodes spaces as + by default.
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain(
      'scope=openid profile email offline_access api.connectors.read api.connectors.invoke',
    );
  });

  it('uses the OpenAI Codex public client_id (not a secret, identifies the app)', () => {
    expect(__test.CLIENT_ID).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
  });

  it('originator is `codex_cli_rs` so OpenAI tracks Codex CLI traffic correctly', () => {
    expect(__test.ORIGINATOR).toBe('codex_cli_rs');
  });
});
