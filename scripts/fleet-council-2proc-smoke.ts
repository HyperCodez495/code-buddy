/**
 * Fleet-council two-process smoke — the cross-instance proof the repo lacked.
 *
 * A coordinator connects (with a scoped JWT) to TWO separate `buddy server` processes (real,
 * distinct PIDs — NOT a single-server loopback), then runs the fleet-council: each remote Code
 * Buddy answers the same question via its own LLM over the WS mesh, and the council judges +
 * reconciles all answers together. Proves "several Code Buddy LLMs collaborate across machines."
 *
 * Setup (two real servers on this box, $0 local Ollama):
 *   JWT_SECRET=s CODEBUDDY_PEER_MODEL=qwen2.5:7b-instruct buddy server --port 3010 --host 127.0.0.1
 *   JWT_SECRET=s CODEBUDDY_PEER_MODEL=gemma4:latest        buddy server --port 3020 --host 127.0.0.1
 * Run:
 *   JWT_SECRET=s PEER_A=ws://127.0.0.1:3010/ws PEER_B=ws://127.0.0.1:3020/ws \
 *     npx tsx scripts/fleet-council-2proc-smoke.ts "<question>"
 */
import { generateToken } from '../src/server/auth/jwt.js';
import { FleetListener } from '../src/fleet/fleet-listener.js';
import { runCouncil } from '../src/commands/council.js';

async function main(): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET required (must match both servers).');
    process.exit(2);
  }
  const urlA = process.env.PEER_A || 'ws://127.0.0.1:3010/ws';
  const urlB = process.env.PEER_B || 'ws://127.0.0.1:3020/ws';
  const task = process.argv[2] || 'En une phrase: quelle est la capitale de la France ?';

  const jwt = generateToken({ sub: 'coordinator', userId: 'coordinator', scopes: ['peer:invoke', 'fleet:listen', 'chat'] as never }, secret, '15m');
  const a = new FleetListener({ url: urlA, jwt, connectTimeoutMs: 15_000, authTimeoutMs: 10_000 });
  const b = new FleetListener({ url: urlB, jwt, connectTimeoutMs: 15_000, authTimeoutMs: 10_000 });
  await a.connect();
  await b.connect();
  console.log(`[coordinator] connected to 2 peers: ${urlA} + ${urlB}`);

  const lines: string[] = [];
  await runCouncil(
    task,
    {
      fleet: true,
      fleetPeers: [
        { id: 'peerA', listener: a },
        { id: 'peerB', listener: b },
      ],
      count: 1, // 1 local + 2 remote peers
      consensus: true,
      peerTimeoutMs: 90_000,
    },
    (s) => {
      lines.push(s);
      console.log(s);
    },
  );

  const out = lines.join('\n');
  console.log('\n=== CHECKS ===');
  console.log('peerA contributed:', out.includes('peerA'));
  console.log('peerB contributed:', out.includes('peerB'));
  console.log('both remote machines collaborated:', out.includes('peerA') && out.includes('peerB'));

  await a.disconnect();
  await b.disconnect();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('FLEET-COUNCIL 2PROC FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
