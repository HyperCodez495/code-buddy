# Code Explorer benchmark — measuring the lift

> **Status: scaffolding, not yet run.** This harness turns the one-shot anecdote
> (`impact executePlan` = 0.62 s / ~150 tokens vs ~24K tokens) into a
> **reproducible A/B measurement** across several tasks. It's the brick that
> turns *"nice repo"* into *"proof a reviewer can't wave away."*

## What it measures

For each task in [`tasks.json`](tasks.json), it runs Code Buddy **headless** on
the same prompt under two conditions:

| Condition | How |
|---|---|
| **With Code Explorer** | the gitnexus MCP enabled (`CODEBUDDY_DISABLE_MCP=false`) |
| **Without Code Explorer** | `CODEBUDDY_DISABLE_MCP=true` — gitnexus is the only enabled MCP here, so this turns off the gitnexus graph, with **no config mutation** |

and records, per condition: **tokens**, **tool-call count**, **wall-clock**.

> **⚠️ Honest framing — this is NOT "graph vs no graph."** Code Buddy ships its
> own built-in graph tools (`code_graph` / `codebase_map`, backed by an internal
> `KnowledgeGraph`). Disabling the gitnexus MCP does **not** remove those — the
> "without" run still has a graph. So what this harness measures is
> **gitnexus's graph vs Code Buddy's built-in graph**, not graph vs grep. On a
> spot check (`impact executePlan`) the built-in answered ~20 affected symbols
> vs gitnexus-over-MCP's 18, i.e. roughly on par — the built-in is a real
> competitor, not a strawman. gitnexus's edge has to come from **breadth**
> (14 languages, whole-repo, the `--direction both` depth the CLI shows = 187)
> rather than "the agent had no graph at all." State that in any writeup, and
> note that gitnexus's MCP `impact direction:both` currently under-reports
> (18 vs the CLI's 187) — a real gap to close before claiming a capability win.

The thesis is two things, framed against the built-in graph (above):
1. **Cost** — does the gitnexus graph answer relationship questions in fewer tokens / tool calls than the built-in path?
2. **Capability** — for transitive questions (`impact`, blast radius), is the answer *more complete*? (Judge against `tasks.json` ground_truth, not against a no-graph run.)

## How to run

```bash
# Prereqs: gitnexus on PATH, repo indexed (`gitnexus analyze .`).
# Keep cost low (no-mocks rule): local Ollama ($0) or a flat-fee login.

BENCH_MODEL=gpt-5.5 REPEATS=3 node docs/code-explorer-benchmark/run.mjs
# → writes results.json + results.md here
```

> **⚠️ Operational reality (validated 2026-06-19 — read before trusting numbers).**
> Headless `buddy -p` **defaults MCP off** (`processPromptHeadless` in
> `src/index.ts`). The harness now sets `CODEBUDDY_DISABLE_MCP=false` for the
> with-graph condition (needs the index.ts opt-in fix that makes headless
> respect an explicit setting) — without it, **both** conditions run without the
> graph and the A/B is meaningless.
>
> **Known gap, not yet closed:** even with MCP enabled in headless, the gitnexus
> tools are **not surfaced to the agent as native `mcp__gitnexus__*` tools** —
> `initializeMCP()` is fire-and-forget and the headless turn starts before the
> server finishes connecting (no `mcpReady` to await). In a real run the agent
> either ignores the graph (uses the built-in `code_graph`/`search`) or
> hand-rolls an MCP client over `bash` to reach it. **Until that is fixed, this
> benchmark cannot fairly measure the lift through the native tool path.** Track
> with the bridge owner before running the full sweep.

Env knobs: `BENCH_MODEL` (model pin, default = repo setting), `REPEATS`
(runs per condition, **use ≥3** — single runs are noisy), `BENCH_BUDDY`
(how to invoke, default `buddy`), `BENCH_TIMEOUT_MS`.

## Correctness pass (separate, on purpose)

The runner measures **cost/effort**. Whether each answer is *right* is judged
separately so the graph can't grade its own homework:

1. Fill in `ground_truth.must_include` for each task in `tasks.json` by hand
   (grep + reading + `npm run check:circular` for the cycle task). Mark
   `status: "VERIFIED"`.
2. Score each `sample_answer` in `results.json` against its ground truth
   (keyword coverage, or an independent LLM-judge).
3. Report **completeness** alongside cost — e.g. *"without the graph the agent
   found 3 of 12 impacted symbols; with it, 12 of 12."*

## Run it only when the numbers will be honest

- **After** Codex's TypeScript support lands and the index is rebuilt, so the
  graph reflects the real TS engine (the headline use case is a TS codebase).
- The graph is a snapshot — `gitnexus analyze . --incremental` before a run.

## Honest caveats (state them in any writeup)

- Single runs vary; report averages over `REPEATS ≥ 3` and note the spread.
- Tasks here are **relationship-shaped** — that's where the graph helps. Don't
  generalize the lift to tasks that are pure code-writing; it won't apply.
- Static-analysis blind spot: edges through dynamic imports may be missing, so
  even the "with graph" run can under-report. Note it; don't hide it.
- One model's numbers aren't all models'. Re-run per model you want to claim.

## Files

```
tasks.json    the N navigation/impact tasks + ground-truth slots
run.mjs       the A/B harness (writes results.json + results.md)
results.json  (generated) raw metrics
results.md    (generated) the comparison table
```
