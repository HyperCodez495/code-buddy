# Spec pipeline (`buddy spec`) — BMAD-inspired, review-gated delivery

Date: 2026-05-23
Inspiration: the BMad Method (spec-driven agentic delivery). This is **not** a
port of BMAD — it maps BMAD's best idea (durable, review-gated, context-rich
work units) onto Code Buddy primitives, the same discipline used for the Hermes
work (map the pattern, don't vendor the framework).

## Why

The fragile part of agentic delivery isn't planning — it's letting the agent run
a whole monolithic objective unsupervised (it loops, it over-reaches, it burns
tokens). The fix is structural: break work into a **durable backlog of stories**,
and **gate implementation on an explicit human approval of each story's spec**.

This is the third application of the propose → human approves → no silent action
discipline already shipped for [lessons](hermes-agent-status.md) (lesson-candidate
queue) and the user model. Here the reviewed artifact is the **unit of work**.

## When to use which planning surface

| Surface | Use it for | Shape |
|---|---|---|
| `buddy dev plan/run/pr/fix-ci` | A single, well-scoped objective you want done quickly | Monolithic: plan → one confirmation → implement → test → summary (`src/commands/dev/workflows.ts`) |
| `buddy flow "<goal>"` | One goal you want decomposed and executed in-session | Ephemeral multi-agent plan → execute → synthesize, in-memory (`src/agent/flow/planning-flow.ts`) |
| **`buddy spec`** | Multi-story work you want to **review story-by-story**, with durable artifacts and lineage | Durable backlog: PRD/architecture → stories → per-story approval gate → implement one at a time |

Rule of thumb: reach for `spec` when the work is big enough that you want to
approve *what* gets built before *any* of it is built, and to track it across
sessions. Reach for `dev`/`flow` for a single contained change.

## Artifacts

```
.codebuddy/specs/
├── active.json                     # pointer to the active project
└── <project-id>/
    ├── project.json                # manifest: id, title, phase
    ├── epics/<epic-id>.md          # epic (JSON frontmatter + body)
    └── stories/<story-id>.md       # context-engineered story
```

Each story `.md` has **JSON frontmatter (authoritative)** + a human-readable
body. The story status lives on the story file; `buddy spec status` derives the
sprint view by reading the stories — there is no second source of truth.

Story ids (`st-…`), epic ids (`ep-…`), project ids (`sp-…`) are stable and
opaque — never positional — so re-sharding never renumbers existing work.

## Story status state machine

```
draft ──approve(--by)──▶ approved ──start──▶ in_progress ──complete(--evidence)──▶ done (terminal)
  │                         │                     │
  └──block(--reason)──▶ blocked ◀────block────────┘
                           │
                           └──reopen──▶ draft        (approved ──reopen──▶ draft to revise)
```

Gates mirror the review discipline:
- **approve** requires a reviewer (`--by`) — nothing is implemented un-approved.
- **complete** requires `--evidence` (test pass / approved review) — `done` is terminal.
- **block** requires `--reason`.

Every legal and illegal transition is covered by `tests/spec/spec-store.test.ts`.

## CLI (foundation)

```bash
buddy spec init "Radar map app"                 # create + activate a project
buddy spec story add "Render radars" -c "shows radars within 5km" -n "webview React layer"
buddy spec status                               # derived sprint view
buddy spec story approve <id> --by "Patrice"    # the gate
buddy spec story start <id> --run <runId>
buddy spec story complete <id> --evidence "npm test green"
buddy spec story block <id> --reason "waiting on API key"
buddy spec story reopen <id>
buddy spec epic add "Map layer" -s "render + move"
```

## Roadmap (this commit = the foundation)

- **Commit 1 (this one):** LLM-free foundation — data model, tested state
  machine, durable artifacts, CLI. Stories are added manually so the backbone is
  provable without any model output.
- **Commit 2:** `buddy spec plan <goal>` — an agent run that drafts `prd.md` →
  `architecture.md` → sharded stories, with a human gate between each phase.
  The PRD/architecture live in `.codebuddy/specs/<project>/` (canonical), with a
  RunStore artifact snapshot of the producing run.
- **Commit 3:** `buddy spec next` — pick the next `approved` story and feed it to
  the autonomous coding runner, the story frontmatter populating tool policy /
  cwd / acceptance criteria, with lineage (story → run → outcome).
