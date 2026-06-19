#!/usr/bin/env node
/**
 * Code Explorer benchmark harness — A/B measurement of the gitnexus MCP lift.
 *
 * For each task in tasks.json, runs Code Buddy headless TWICE on the same
 * prompt:
 *   - WITH    Code Explorer: the gitnexus MCP enabled (default config)
 *   - WITHOUT Code Explorer: CODEBUDDY_DISABLE_MCP=true (gitnexus is the only
 *     enabled MCP here, so disabling MCP === "no Code Explorer") — no config
 *     mutation needed.
 *
 * It captures tokens, tool-call count, and wall-clock for each, then writes
 * results.json + results.md. Correctness is judged separately (see README) —
 * this harness measures COST and EFFORT; whether each answer is right is a
 * second pass against tasks.json ground_truth.
 *
 * STATUS: scaffolding. Do not trust numbers until:
 *   1. Codex's TypeScript support has landed and the index is rebuilt
 *      (`gitnexus analyze .`), so the graph reflects the real TS engine.
 *   2. ground_truth in tasks.json is filled in and verified.
 *   3. You run with REPEATS > 1 — single runs are noisy.
 *
 * Usage:
 *   BENCH_MODEL=gpt-5.5 node docs/code-explorer-benchmark/run.mjs
 *   BENCH_MODEL=ollama:qwen2.5-coder REPEATS=3 node docs/code-explorer-benchmark/run.mjs
 *
 * Keep cost low (no-mocks rule): prefer local Ollama ($0) or a flat-fee login.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

// ---- config -------------------------------------------------------------
const BUDDY = process.env.BENCH_BUDDY || 'buddy';          // or: 'node dist/index.js'
const MODEL = process.env.BENCH_MODEL || '';               // '' = repo default (.codebuddy/settings.json)
const REPEATS = Number(process.env.REPEATS || 1);
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 180_000);

// Headless `buddy -p` defaults MCP **off** (see processPromptHeadless in
// src/index.ts) — so the with-graph condition MUST opt in explicitly with
// CODEBUDDY_DISABLE_MCP=false, otherwise BOTH conditions run without the graph
// and the A/B measures nothing. (Requires the index.ts opt-in fix that lets
// headless respect an explicit setting.) We also point the bundled-skills tier
// at the source dir so the `code-explorer` skill loads and nudges the agent
// toward the graph tools — it is not present at the runtime `.codebuddy/skills/
// bundled` path in a plain checkout.
const SKILLS_DIR = path.resolve(REPO, 'src', 'skills', 'bundled');
const CONDITIONS = [
  { key: 'with_graph', label: 'With Code Explorer', env: { CODEBUDDY_DISABLE_MCP: 'false', CODEBUDDY_BUNDLED_SKILLS_DIR: SKILLS_DIR } },
  { key: 'without_graph', label: 'Without Code Explorer', env: { CODEBUDDY_DISABLE_MCP: 'true' } },
];

// ---- helpers ------------------------------------------------------------
function runBuddy(prompt, extraEnv) {
  const args = ['--prompt', prompt, '--output-format', 'json'];
  if (MODEL) args.push('--model', MODEL);
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      BUDDY.split(' ')[0],
      [...BUDDY.split(' ').slice(1), ...args],
      { cwd: REPO, env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS },
      (err, stdout, stderr) => {
        const wall_ms = Date.now() - started;
        resolve({ wall_ms, stdout: stdout || '', stderr: stderr || '', error: err ? String(err.message || err) : null });
      }
    );
  });
}

/** Pull token + tool-call metrics out of whatever shape the JSON output uses.
 *  Defensive: field names are confirmed on the first real run, then pinned. */
function extractMetrics(stdout) {
  let json;
  try { json = JSON.parse(stdout); } catch { return { parsed: false, total_tokens: null, tool_calls: null, answer: stdout.slice(0, 400) }; }
  const usage = json.usage || json.tokenUsage || json.metrics || {};
  const inOut = (usage.input_tokens ?? usage.inputTokens ?? 0) + (usage.output_tokens ?? usage.outputTokens ?? 0);
  const total_tokens =
    json.tokensUsed ?? usage.total_tokens ?? usage.totalTokens ?? (inOut || null);
  const tool_calls =
    json.numToolCalls ?? json.toolCalls?.length ?? json.num_turns ??
    (Array.isArray(json.messages) ? json.messages.filter(m => m.tool_calls?.length).length : null);
  const answer = json.result ?? json.content ?? json.text ?? json.response ?? '';
  return { parsed: true, total_tokens, tool_calls, answer: String(answer).slice(0, 600) };
}

const avg = (xs) => { const v = xs.filter(n => typeof n === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

// ---- main ---------------------------------------------------------------
const { tasks } = JSON.parse(await readFile(path.join(__dirname, 'tasks.json'), 'utf-8'));
const results = [];

for (const task of tasks) {
  const row = { id: task.id, category: task.category, conditions: {} };
  for (const cond of CONDITIONS) {
    const runs = [];
    for (let i = 0; i < REPEATS; i++) {
      process.stderr.write(`▸ ${task.id} · ${cond.key} · run ${i + 1}/${REPEATS}\n`);
      const r = await runBuddy(task.prompt, cond.env);
      runs.push({ ...extractMetrics(r.stdout), wall_ms: r.wall_ms, error: r.error });
    }
    row.conditions[cond.key] = {
      tokens: avg(runs.map(r => r.total_tokens)),
      tool_calls: avg(runs.map(r => r.tool_calls)),
      wall_ms: avg(runs.map(r => r.wall_ms)),
      sample_answer: runs[0]?.answer ?? '',
      errors: runs.filter(r => r.error).map(r => r.error),
    };
  }
  results.push(row);
}

await writeFile(path.join(__dirname, 'results.json'), JSON.stringify({ model: MODEL || '(repo default)', repeats: REPEATS, results }, null, 2));

// ---- markdown report ----------------------------------------------------
const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
let md = `# Code Explorer benchmark — results\n\n`;
md += `Model: \`${MODEL || '(repo default)'}\` · repeats: ${REPEATS}\n\n`;
md += `| Task | Tokens (w/o → with) | Tool calls (w/o → with) | Wall ms (w/o → with) |\n`;
md += `|---|---|---|---|\n`;
for (const r of results) {
  const w = r.conditions.with_graph, wo = r.conditions.without_graph;
  const delta = (a, b) => (a && b ? ` (${b < a ? '−' : '+'}${Math.abs(Math.round((1 - b / a) * 100))}%)` : '');
  md += `| \`${r.id}\` | ${fmt(wo.tokens)} → ${fmt(w.tokens)}${delta(wo.tokens, w.tokens)} | ${fmt(wo.tool_calls)} → ${fmt(w.tool_calls)} | ${fmt(wo.wall_ms)} → ${fmt(w.wall_ms)} |\n`;
}
md += `\n> Correctness is judged separately against \`tasks.json\` ground_truth — these columns are COST and EFFORT only.\n`;
await writeFile(path.join(__dirname, 'results.md'), md);

process.stderr.write(`\n✓ wrote results.json + results.md\n`);
