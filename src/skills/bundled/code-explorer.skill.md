---
name: code-explorer
description: Use the Code Explorer (gitnexus) code-graph MCP tools to understand a codebase through precise relationships — callers, callees, blast radius — instead of reading many files
version: 1.0.0
tags: [codebase, architecture, impact, blast-radius, callers, callees, refactor, dead-code, hotspots, complexity, dependencies, cycles, who-calls, where-used, gitnexus, code-explorer, code-graph]
tier: bundled
---

# Code Explorer — code-graph intelligence

When the **Code Explorer / gitnexus** MCP tools are available, prefer them over reading or grepping many files to reason about a codebase's structure. They query a pre-indexed knowledge graph and return precise relationships instantly, which keeps your context window free for actual reasoning.

Code Explorer is an **optional proprietary add-on** — if its tools are not present, ignore this skill and work normally; Code Buddy does not depend on it. The repository must be indexed once: `gitnexus analyze .` (then `--incremental` after changes).

## First: select the repo (the tools fail closed without it)

The graph tools (`context`, `impact`, `query`, `coverage`, `find_cycles`, …) operate on **one indexed repository**, chosen by a `repo` argument. The server keeps a **global registry** of every repo ever indexed (often many — test dirs, sibling projects), so when more than one is present it **cannot guess** and returns an error like *"Multiple repos indexed (N). Specify 'repo' parameter."*

So, **once per session before the first graph call:**

1. Call **`list_repos`** to see what's indexed — each entry has a `name`, a `path`, and an `id`.
2. Pick the one whose `path` matches the project you're working in.
3. Pass it as `repo` on **every** subsequent call: **use the full `path` (or `id`), not the bare `name`** — names collide (two different projects can both be `src`), paths and ids don't.

If `list_repos` shows the current project isn't indexed yet, that's the `gitnexus analyze .` step — surface it rather than guessing a repo.

## Reach for the graph when the question is about *relationships*

| You need to… | Tool | Instead of |
|---|---|---|
| Find where a symbol is defined | `query` / `search_code` | reading many files |
| See a symbol's callers, callees, imports, hierarchy | `context` | tracing call chains by hand |
| Know what breaks if you change X (blast radius) | `impact` | guessing / reading the whole module |
| Assess the risk of the current uncommitted diff | `detect_changes` | eyeballing the diff |
| Find circular dependencies | `find_cycles` | — |
| Find duplicate / near-duplicate code | `find_similar_code` | — |
| Find churn/coupling hotspots, complexity, dead code | `hotspots` / `coupling` / `get_complexity` / `coverage` | — |
| Multi-file rename, graph-confirmed | `rename` (keep `dry_run` first) | risky text replace |
| Anything else the named tools don't cover | `cypher` (read-only) | — |

## Rules

- **Always pass `repo` (the project's `path` or `id` from `list_repos`).** Omitting it errors out whenever more than one repo is indexed, and the bare `name` is ambiguous. Resolve it once at the start of the session and reuse it.
- **Before refactoring or changing a shared/core symbol, run `impact <symbol>` first** and state the blast radius. This is the single highest-value habit — it turns "I think this is safe" into "these 6 callers are affected."
- For "how does X work?" on a large or unfamiliar codebase, start with `context <symbol>` (360° view) before opening files.
- These tools are **read-only analysis** (except `rename`, which defaults to a dry run). They tell you *where* and *what's affected*; they don't replace editing.
- The graph is a snapshot — if you've made large structural changes, re-index with `gitnexus analyze . --incremental` before trusting impact/context results.
- **Static analysis caveat:** call edges that flow through **dynamic imports** (`await import(...)`) may be missing from the graph. So `impact` can under-report, and "no callers / dead code" is a *candidate*, not proof — confirm with a text search before deleting anything. Treat the graph as a fast, precise navigation aid, not an exhaustive call graph.
