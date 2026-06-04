/**
 * Cross-host fleet round-trip smoke test.
 *
 * Proves that one Code Buddy can drive another over the fleet WS mesh:
 * connects to a remote peer's Gateway `/ws`, authenticates with a
 * short-TTL JWT carrying the `peer:invoke` scope (minted with the
 * codebase's own `generateToken`, so the remote `verifyToken` accepts it),
 * runs `peer.describe` to confirm the handshake, then a `peer.chat`
 * one-shot answered by the remote peer's wired LLM.
 *
 * This is the missing client half of the "Niveau 2" cross-host POC: the
 * receiving server's `peer.chat` requires `peer:invoke`, which `--no-auth`
 * does NOT grant — so the supported path is auth-enabled + a scoped JWT,
 * which is exactly what this script produces. No code change to the
 * server, no weakening of `--no-auth`.
 *
 * Usage (the SAME JWT_SECRET must be set on the peer server):
 *   JWT_SECRET=... FLEET_PEER_URL=ws://HOST:3010/ws \
 *     npx tsx scripts/fleet-roundtrip-smoke.ts "optional prompt"
 *
 * Env:
 *   JWT_SECRET      required — must match the peer server's JWT_SECRET
 *   FLEET_PEER_URL  default ws://localhost:3010/ws
 *   FLEET_JWT_USER  default fleet-smoke-client
 *   FLEET_JWT_TTL   default 15m
 *   FLEET_ARTIFACT  default fleet-roundtrip-artifact.json (set "" to skip)
 */

import * as fs from 'node:fs';
import { generateToken } from '../src/server/auth/jwt.js';
import { FleetListener } from '../src/fleet/fleet-listener.js';

async function main(): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is required (must match the peer server).');
    process.exit(2);
  }
  const url = process.env.FLEET_PEER_URL || 'ws://localhost:3010/ws';
  const userId = process.env.FLEET_JWT_USER || 'fleet-smoke-client';
  const ttl = process.env.FLEET_JWT_TTL || '15m';
  const artifactPath =
    process.env.FLEET_ARTIFACT === undefined
      ? 'fleet-roundtrip-artifact.json'
      : process.env.FLEET_ARTIFACT;
  const prompt =
    process.argv[2] ||
    'You are a remote Code Buddy peer reached over the fleet. In ONE sentence, ' +
      'confirm you received this cross-host request and name the local model answering it.';

  const jwt = generateToken(
    { sub: userId, userId, scopes: ['peer:invoke', 'fleet:listen', 'chat'] },
    secret,
    ttl,
  );

  const listener = new FleetListener({
    url,
    jwt,
    connectTimeoutMs: 15_000,
    authTimeoutMs: 10_000,
  });

  const tConnect = Date.now();
  await listener.connect();
  console.log(`[connected+authenticated] ${url} (${Date.now() - tConnect}ms)`);

  const describe = await listener.request('peer.describe', {}, { timeoutMs: 20_000 });
  console.log('[peer.describe]', JSON.stringify(describe));

  const tChat = Date.now();
  const chat = await listener.request('peer.chat', { prompt }, { timeoutMs: 180_000 });
  const chatLatencyMs = Date.now() - tChat;
  console.log(`[peer.chat] (${chatLatencyMs}ms)`);
  console.log(JSON.stringify(chat, null, 2));

  await listener.disconnect();

  if (artifactPath) {
    const artifact = {
      when: new Date().toISOString(),
      url,
      prompt,
      describe,
      chat,
      chatLatencyMs,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    console.log(`saved ${artifactPath}`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('FLEET ROUND-TRIP FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
