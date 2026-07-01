# Cowork Redesign — "simple to use, aligned with Code Buddy"

> Status: **proposal / thinking** (not yet approved or implemented). Grounded in three explorations
> (2026-07-01): the Code Buddy capability surface, the current Cowork front-end map, and web UX
> research on simple agentic desktop apps. See the summary at the bottom for sources.

## Thesis

The redesign is a **subtraction** problem, not a build problem. Cowork already contains everything
(302 `.tsx` renderer files, ~40 overlay panels, 30 settings tabs, 16 Hermes parity strips, 2 workflow
editors). What it lacks is a **navigation model** and a **center of gravity**. Today the whole app is
~44 `show*` booleans in the Zustand store toggling ~40 sibling overlays, launched from **three
overlapping nav surfaces** (`TopMenuBar` menus, `ShellNavigation` rail, `TabBar`), with dead code
(`Sidebar.tsx`, 30 KB, never rendered) still shipping.

Good news on the seam: **Cowork does not wrap the `buddy` CLI — it embeds the same `src/` core
in-process** (`loadCoreModule()` → `CodeBuddyEngineAdapter` → `CodeBuddyAgent`). So "align with Code
Buddy" means **foreground the CLI's real center of gravity and share the capability model** — it's a
front-end IA job, not a rewiring job.

## What Code Buddy is actually for (the center of gravity)

From the CLI/capability map, the 6–8 things a user actually does:
**chat with the agent on a folder · pick a free/cheap brain (ChatGPT/xAI login or local Ollama, $0) ·
resumable sessions + memory · safe autonomy (ask → auto-edit → goal loop) · plain-language skills
(Office docs / charts / research) · optional voice + companion.** Everything else — fleet mesh, MCP
management, self-improvement, observability internals, Hermes/OpenClaw parity, reasoning-depth
tuning — is **power-user** and should not greet a first-time user.

## Target information architecture

Replace the 44-flag overlay soup with **one shell, 3 primary areas + a deferred Advanced/Labs
drawer**. A real view model (a `view` enum / router in the store), not `show*` booleans.

```
┌ Titlebar: workspace folder · brain (model/login) · autonomy posture · power(server) · ⌘K ┐
│                                                                                          │
│  HOME (empty-state)                     ACTIVE SESSION                                    │
│  ┌────────────────────────────┐        ┌───────────── Chat ──────────┬─ Activity ──────┐ │
│  │  “What do you want to       │   →    │  conversation only          │ live step log   │ │
│  │   build?”  [ one input ]    │        │  (turns, replies)           │ plan ▸ approve  │ │
│  │  recent sessions ▾          │        │                             │ diffs / blocks  │ │
│  │  quick: fix · research ·    │        │                             │ undo last turn  │ │
│  │         make a doc          │        └─────────────────────────────┴─────────────────┘ │
│  └────────────────────────────┘                                                          │
│                                                                                          │
│  Left rail (thin, collapsible): Chat · Activity · Workspace(files/diffs) · [Advanced ▾]   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Home** = one input box + recent sessions + 3 quick-action chips. ~60s to first value.
- **Chat** = conversation only (no autonomous-work noise folded in).
- **Activity** = the single place agent work is shown: live plain-language step log, the
  **plan-then-act approve list**, per-change **side-by-side diffs / command blocks**, and
  **one-click undo** (promote the existing `CheckpointPanel`).
- **Workspace** = files + diffs + git (on demand).
- **Advanced ▾ / Labs** = everything dense, hidden until needed.

## Surface mapping (foreground / advanced / labs / delete)

| Current surface | New home |
|---|---|
| `WelcomeView`, `ChatView`, `ChatList`, `MessageComposer`, `ModelSwitcher`, `PermissionModeSelector` | **Foreground** (Home + Chat) |
| `ReasoningTraceViewer`, `SubAgentPanel`/`SubAgentDashboard`/`AgentMonitoringDashboard`, tool-stream | **Foreground**, *consolidated* into the single **Activity** feed |
| `CheckpointPanel`, `DiffViewer`, `GitStatusPanel`, `FileTree` | **Foreground** (Activity/Workspace) — checkpoint → one-click "Undo last turn" |
| `MemoryPanel`, `SessionInsights`, sessions/resume | **Foreground** (secondary but easy) |
| Skills (Office/charts/research), `KnowledgeBaseBrowser` | **Foreground** as plain-language outcomes ("make an Excel", "research X") |
| `CompanionPanel` (158 KB), voice overlays, channels | **Advanced** — one opt-in "Companion" capability card, not always-on |
| `SettingsPanel` (30 tabs), `UserModelPanel`, `ChannelsPanel` | **Advanced** — first run needs none of it (sane defaults + free brain) |
| `FleetPanel`+`FleetPeerSessionPanel`+`KanbanPanel`+`MissionBoardPanel`, `AutonomyPanel`, `OrchestratorLauncher` | **Advanced**, *consolidated into ONE board*, revealed only when >1 agent/peer runs |
| `WorkflowEditor` + `workflow_pro/*` (~80 files, 2 editors, `EditorPanels` + `EditorPanelsRefactored`) | **Advanced/Labs** — pick ONE editor; plan-then-act covers the common case inline |
| 16 `hermes-*-strip.tsx` + `ClawMigrationDialog`, `AuditLogViewer` (85 KB), `Diagnostics*`, `CostTrends`, `ServerDashboard` | **Labs** (explicit experimental/dev drawer) |
| `Sidebar.tsx` (dead, 30 KB), `TopMenuBar` (duplicates the rail), the empty `showReasoningViewer` branch, `components/index.ts` unused barrel | **Delete** |

## The UX moves that make it "simple" (from the research)

1. **One input box** on launch — "just tell it what you want" (TTFV ~60s).
2. **Progressive disclosure** — 3 areas + one Advanced drawer; a panel that isn't needed for the task isn't visible.
3. **Chat ≠ activity feed** — separate cadences; fold the 3 overlapping agent-monitoring views into one.
4. **Plan-then-act** — show the plan as an approvable/editable step list *before* the 4-agent pool runs (surface `WorkflowBridge` inline, don't send users to the editor).
5. **Live reasoning line, not a spinner** — stream `tool_stream`/`reasoning` as one plain-language line, expandable.
6. **Auto-approve safe / gate risky** — reads/searches run silently; only writes/shell/destructive raise a calm inline prompt (wire existing permission modes; no modal storm).
7. **Reviewable diffs/blocks + one-click undo** — side-by-side diffs per change, labeled command blocks, per-turn checkpoint restore.
8. **Sane defaults + progressive delegation** — ship a working free brain; default posture "ask", then "you've approved this 10× — auto-run it?" instead of a YOLO toggle up front.
9. **Fleet is a power feature, deferred** — never the home screen; appears only when the user is actually running many agents.
10. **Calm failure** — one inline "what happened + next step" card; binary "confident / please review" over scary percentages.

## Migration plan (incremental — do NOT big-bang 302 files)

1. **Introduce a view model** — add a `view: 'home' | 'chat' | 'activity' | 'workspace' | 'advanced'`
   to the store; render one primary area by it. Keep the old `show*` overlays working in parallel
   (feature-flag `COWORK_NEW_SHELL`) so nothing breaks.
2. **Build the new shell** — Home (one input + recents) + Chat + a consolidated **Activity** pane
   (merge `SubAgent*`/`AgentMonitoring*`/reasoning trace). Wire plan-then-act + inline diffs + undo
   onto events the core already emits.
3. **Demote** — move Settings/Companion/Fleet/Workflows behind the Advanced drawer; collapse the 3
   nav surfaces into the thin rail; delete `Sidebar.tsx`, `TopMenuBar` duplication, dead branches.
4. **Consolidate the dense clusters** — one fleet board, one workflow editor, Hermes strips → Labs.
5. **Flip the default** to the new shell once parity is proven; keep old shell behind a setting one release.

Anchor files: `src/renderer/App.tsx`, `src/renderer/store/index.ts`, `ShellNavigation.tsx`,
`TopMenuBar.tsx`, `Titlebar.tsx`/`TabBar.tsx`, `DockWorkspace.tsx`, `ChatView.tsx`, `SettingsPanel.tsx`;
seam untouched at `src/main/index.ts` + `src/main/engine/codebuddy-engine-runner.ts`.

## Sources (web UX research)
Agentic-design UI/UX patterns; Fuselab "Agent UX 2026"; UXPin/UI-Patterns progressive disclosure;
Warp Agent Mode (blocks, gated actions); Cline Plan/Act; Roo Code side-by-side diffs; Cursor
checkpoints; Appcues/Userpilot time-to-first-value & sensible defaults; GitHub/Windsurf mission
control (fleet as deferred power feature).
