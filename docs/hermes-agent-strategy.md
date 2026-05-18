# Hermes Agent strategy note

Date: 2026-05-16

Scope: Code Buddy weekend worktree. Hermes Agent was reviewed as a
strategic benchmark after the OpenClaw integration audit.

External reference snapshot:

- Repository: `https://github.com/NousResearch/hermes-agent`
- Public docs: `https://hermes-agent.nousresearch.com/docs/`
- Local review clone: `D:\CascadeProjects\_external\hermes-agent`
- Reviewed commit: `d725407`
- Latest public release seen during review: Hermes Agent v0.14.0
  (2026-05-16)
- Public docs refreshed on 2026-05-16 still emphasize the same signals:
  learning loop, persistent memory, skills, messaging gateway, scheduled
  automations, MCP, subagents and terminal backends.
- Public docs checked again on 2026-05-16 for this pass: the strongest
  transferable ideas remain closed-loop learning, FTS5 recall,
  portable skills, filtered toolsets, scheduled automations and
  programmatic tool calling through scripts/RPC.
- Public docs checked again on 2026-05-17 for this pass: the immediate
  Code Buddy translation is not another runtime, but a Hermes-style
  visible TODO/work-queue loop inside Cowork workflows.
- Browser automation docs checked on 2026-05-17: Stagehand's useful
  transfer is the `observe` / `act` / `extract` posture on top of
  Playwright, not an immediate dependency swap. Mem0's useful transfer is
  the memory-provider boundary, not replacing Code Buddy's SQLite-first
  local memory.

Internet automation references:

- Stagehand landing/docs: `https://www.browserbase.com/stagehand/`,
  `https://docs.browserbase.com/welcome/quickstarts/stagehand`
- Mem0 OSS docs: `https://docs.mem0.ai/open-source/overview`,
  `https://docs.mem0.ai/open-source/node-quickstart`

## Hermes-inspired TODO for the next Code Buddy passes

These are the bounded items to implement without changing the stack:

1. **Visible workflow TODOs in Cowork** — every long-running workshop
   should expose the next useful actions, not only a completed/pending
   progress rail. Status: implemented first for the Word-workshop panel.
2. **Outcome-to-memory loop** — Fleet and workshop outputs should become
   curated project memory only after an operator action or a strong
   confidence signal. Status: first Fleet outcome memory loop exists;
   Word-workshop now has an operator-triggered memory save action from
   the progress panel.
3. **Filtered tool posture** — keep the current dispatch profiles and
   evolve them toward real toolset constraints. Status: profile metadata
   crosses CLI, Cowork and peer RPC; Fleet now also exposes
   Hermes-style `fleet.hermes.<profile>` toolset descriptors derived
   from the existing Code Buddy policy resolver. Code Buddy also ships a
   built-in `hermes` custom-agent profile (`buddy --agent hermes`) plus
   `buddy hermes profile` / `buddy hermes doctor` diagnostics, and
   custom-agent `tools` / `disabledTools` now feed the runtime tool
   filter. The active custom-agent runtime now also carries Hermes'
   default Fleet dispatch profile into `route_peer` and `peer_delegate`,
   so delegated calls keep a concrete `fleet.hermes.<profile>` posture
   even when the model omits the optional argument. Peer chat and
   chat-session bridges now also merge dispatch policy hints into custom
   system prompts, so user-provided peer persona prompts no longer drop
   the selected Hermes toolset posture. The same dispatch-profile
   selection guide now feeds the Hermes prompt, Fleet tool schemas, CLI
   diagnostics and docs, reducing drift between what operators see and
   what the model is told to choose. Deeper peer-side execution
   enforcement remains future work.
4. **Portable skills** — keep `SKILL.md` packages as the durable
   procedural-memory boundary. Status: telemetry exists; install/update
   ergonomics remain future work. The lessons store now also has a
   mini-Obsidian graph surface (`lessons_graph` / `buddy lessons graph`)
   that keeps Markdown as the canonical memory and derives nearby
   notions from wiki links, Markdown links, tags, related metadata,
   context labels and keywords. The same surface emits explicit JSON
   backlinks for tooling, Obsidian-friendly Markdown indexes, and
   Mermaid text for a future visual cockpit, can focus on one concept
   with `--concept <name>`, can disable fallback keyword concepts with
   `--no-keywords` for a cleaner explicit-link/tag graph, and
   `buddy lessons graph --graph-output <file>` can write those artifacts
   for UI consumption while inferring JSON/Markdown/Mermaid format from
   the output extension when no explicit format flag is provided.
   `buddy lessons graph --vault <dir>` writes a full Obsidian-style
   folder with `index.md`, `_concepts.md`, `_lessons.md`,
   `concepts/*.md`, `lessons/*.md`, `graph.json`, `graph.mmd` and
   `manifest.json`, including YAML frontmatter for page type, backlinks
   and concepts. The manifest also maps concept and lesson ids to their
   generated files so UI consumers can load the vault without directory
   scanning, while keeping `lessons.md` canonical.
5. **Scheduled autonomous work** — keep scheduled dispatches visible in
   Cowork and Activity Feed. Status: first cockpit pass exists; delivery
   channels remain future work.
6. **Internet automation and self-tests** — use the current Playwright
   browser layer as the Stagehand-like boundary: observe a page before
   acting, extract structured evidence, assert the expected page state,
   then promote only proven facts to memory. Status: first CLI/browser
   actions `observe`, `extract` and `assert_text` exist without adding a
   new dependency.

## Decision

Keep the Code Buddy stack.

Hermes is useful because it shows a mature shape for a long-running
personal agent, but Code Buddy should not become a Python port or a
Hermes fork. The intended stack remains:

- React / TypeScript for Cowork and the human cockpit.
- TypeScript / Node for the CLI, provider routing, tool execution,
  Fleet Gateway, skills and server APIs.
- Rust sidecars for system-level capabilities where native performance,
  desktop integration or audio/device work justify the boundary.
- SQLite as the durable local state layer, using the existing
  `better-sqlite3` foundation before adding any new storage dependency.

Hermes should replace OpenClaw as the primary architecture benchmark for
agent operating-system patterns. OpenClaw remains historical context and
a possible external-channel bridge, but Hermes is the stronger source of
ideas for memory, sessions, skills, profiles, cron and multi-agent work.

## Why Hermes matters

Hermes is built by Nous Research and is actively maintained. Its public
README presents it as a self-improving AI agent with a learning loop:
agent-curated memory, skill creation, skill improvement, session search,
user modeling, gateway channels and scheduled jobs.

The important signal for Code Buddy is not the language or exact code
shape. It is the product direction: Hermes treats an agent as a durable
personal operating system, not just a chat wrapper.

## Comparison matrix

| Area | Hermes signal | Code Buddy status | Code Buddy direction |
|---|---|---|---|
| Core stack | Python agent plus TypeScript web/TUI pieces | TypeScript CLI/server, React/Cowork, Rust sidecar | Keep Code Buddy stack; adapt patterns, not code. |
| Agent loop | Large mature agent loop with tool repair, iteration budgets, delegation and summaries | `CodeBuddyAgent`, facades and executor loop already form a native agent runtime | Audit Hermes loop ideas only where they improve reliability: tool-call repair, max-iteration summaries, delegation caps. |
| Session store | `hermes_state.py` uses SQLite with FTS5, WAL and `parent_session_id` chains | Code Buddy already has SQLite repositories and WAL, but session search/lineage are not first-class | Add FTS-backed session search and session lineage before inventing another memory layer. |
| Memory | Pluggable memory providers and user modeling | Code Buddy has memory repositories, ICM/hybrid memory work and local persistence | Add a provider boundary later: local SQLite first, optional Honcho/Mem0/Supermemory-style adapters second. |
| Skills | Large official/optional skill library, agentskills.io, curator patterns | Real `src/skills/hub.ts` exists; stale mock registry was retired in the OpenClaw audit | Make SKILL.md packages first-class, track usage, support optional installs and prune stale generated skills. |
| Gateway channels | Telegram, Discord, Slack, WhatsApp, Signal, email and more | Code Buddy Fleet Gateway is mainly AI-to-AI and Cowork-facing | Keep Fleet as the brain. Add external channels only through a narrow bridge when Cowork/Fleet is stable. |
| Cron | First-class scheduler with platform delivery | Code Buddy has long-running autonomy and operational docs, but scheduled work is not a main cockpit surface | Surface scheduled jobs in Cowork and connect them to Fleet/task state. |
| Kanban / task board | Durable SQLite-backed board for profiles and workers | Code Buddy has disk-backed Fleet sagas, Activity Feed and multi-agent coordination | Keep the existing saga store first; move to SQLite only if query/reporting needs exceed JSON files. |
| Profiles | Isolated `HERMES_HOME` profiles | Code Buddy has profiles/TOML and historical `GROK_HOME` naming | Introduce clear `CODEBUDDY_HOME` semantics while preserving compatibility aliases. |
| ACP / editors | ACP adapter for editor integration | Code Buddy has ACP protocol pieces and VS Code extension packages | Study ACP only after CLI, Cowork and Fleet flows are stable. |
| Windows | Native Windows is early beta; WSL2 is the strongest path | Code Buddy is already Windows-first in Patrice's workflow | Make Windows reliability a Code Buddy advantage. |

## Immediate roadmap

1. Keep the current React / TypeScript / Rust architecture. Status:
   documented and locked in this note.
2. Add a small session-search milestone. Status: first pass implemented
   in SQLite with FTS5-backed message search and CLI match snippets.
   - FTS5 virtual table for messages.
   - `buddy --search-sessions` command with parent lineage and snippet
     metadata.
   - tests for query sanitization and result ranking.
3. Add session lineage. Status: first pass implemented in SQLite with
   `parent_session_id`, plus clone/branch metadata persistence.
   - parent/child session relationship for compaction, branching and
     long autonomous runs.
   - Cowork display that shows where a resumed thread came from.
4. Consolidate skills:
    - keep `src/skills/hub.ts` as the only hub direction.
    - add SKILL.md package metadata and usage telemetry. Status:
      first local telemetry pass implemented in the hub lockfile with
      invocation/success/failure counts, duration averages and executor
      lifecycle events.
    - avoid any mock marketplace surface. Status: stale mock registry
      retired during the OpenClaw audit pass.
5. Make scheduled work visible:
   - scheduled task list in Cowork. Status: existing Settings schedule
     manager remains the authoring surface; Fleet Command Center now
     shows a compact scheduled-work strip with enabled count, next
     runs, schedule rule chips, last-run state, recent session id and
     last-error markers. Successful and failed scheduled runs now also
     write lightweight Activity Feed entries without persisting prompt
     content in the activity metadata. The Activity Feed has a Scheduled
     filter, and the Fleet Command Center can trigger an upcoming
     scheduled task immediately through the existing scheduler IPC or jump
     back to the Settings schedule authoring surface. The current Fleet
     dispatch goal/profile/privacy/memory context can now also be converted
     into a schedule draft. Fleet-created schedules persist lightweight JSON
     metadata (`source`, `dispatchProfile`, `privacyTag`, `parallelism`) so
     later cockpit views and Activity Feed entries can explain why a scheduled
     run exists without storing prompt content in activity metadata. Settings
     Schedule also renders the same Fleet metadata chips when administering
     scheduled tasks and when editing a Fleet-created draft before save. The
     Fleet Command Center prioritizes Fleet-origin scheduled tasks in its
     compact upcoming-work strip, shows a Fleet-origin scheduled count, keeps
     Fleet-origin scheduled events visible in both the Scheduled and Fleet
     Activity Feed filters, and refreshes Fleet activity immediately after a
     manual scheduled "Run now". Fleet-created schedules also carry only a
     memory-context flag and count, never memory contents, so the cockpit can
     explain why a run used context without leaking the actual learned text.
     Clicking a scheduled Activity Feed event now opens Settings -> Schedule
     even when the event originated from Fleet; pure Fleet events still open
     the Fleet Command Center. The classification, chip and navigation logic
     is covered by direct helper tests instead of source-string checks only.
     Fleet-created scheduled dispatches now also inherit the same internet
     proof-loop summary metadata as immediate dispatches, so Settings, the
     upcoming-work strip and scheduled Activity Feed events can show the
     expected web-proof burden before and after the run. Scheduled Activity
     Feed entries now also render the compact proof-loop step list, so an
     operator can see whether a scheduled web run planned search, fetch,
     browser extraction, assertion and persistence work without opening the
     saga detail. Fleet-created schedules also capture the number of routable
     peers available when the schedule was drafted, giving future runs a
     lightweight peer-availability breadcrumb without storing prompt content.
   - target peer/profile and delivery channel remain future work.
6. Make the Word-workshop flow preserve source analysis assets. Status:
   first roundtrip implemented for DOCX screenshots and final Word
   deliverables.
   - Cowork can attach source DOCX/PDF files to a React chat session and
     inject focused workshop guidance for question extraction, answer
     generation and deliverable synthesis.
   - `document read` now preserves DOCX paragraphs, tables and real
     embedded-image markers without mistaking hyperlink relationships for
     screenshots.
   - `document extract_images` extracts DOCX `word/media/*` screenshots
     into local files and returns `markdownRef` values so an agent can run
     OCR or visual analysis before answering, then reuse the same images in
     the generated deliverable.
   - `generate_document` can embed local bitmap image references back into
     the generated DOCX with aspect-ratio fitting and visible captions,
     which lets the final report include source screenshots alongside the
     generated technical answers.
   - Cowork artifact detection now surfaces both generated documents and
     extracted screenshot files, while ordinary document reads do not appear
     as generated artifacts.
   - Cowork now exposes the Word-workshop trigger from both the welcome
     composer and an active chat, with Electron smoke coverage for a selected
     DOCX attachment.
   - The workshop progress panel recognizes DOCX/PDF source reading,
     functional-analysis context capture, question extraction, screenshot
     extraction, OCR, generated deliverables and visible artifacts, including
     tolerant adapter aliases.
   - The generated workshop prompt now asks the agent to emit visible
     progress markers for context mapping, question inventory and OCR, and to
     maintain a compact question/context/screenshot-OCR/answer registry that
     can be reused in the final deliverable.
   - Generated DOCX text is sanitized for XML-invalid control characters
     before writing titles, headings, paragraphs, table cells and image
     captions. The DOCX validation path also fails explicitly if
     `word/document.xml` still contains an XML-invalid character, which guards
     against Word refusing a generated file.
   - Real smoke proof: `npm run smoke:docx` copied
     `gitnexus-rs-from-c/questions/Questions - Impacts.docx`, kept the source
     hash unchanged, read 33,082 characters, extracted 27 screenshots,
     generated a DOCX deliverable with 27 embedded images, and validated DOCX
     relationships/media.
   - Next polish: automate OCR-to-question binding and make
     answer-to-screenshot traceability visible in the workshop panel.
7. Keep Fleet sagas durable and visible. Status: existing disk-backed
   saga store confirmed; storage now follows `CODEBUDDY_HOME`; Cowork
   now groups sagas into a small status board for queued, running,
   completed and blocked work, with a selectable route/detail pane.
   - Activity Feed reads durable outcomes, not only live events.
     Status: terminal saga outcomes are already persisted in the
     Activity Feed and now surface back into the Fleet Command Center
     as recent selectable outcomes with final-result/error previews.
     Outcome details can be copied quickly for reuse in a follow-up run
     or an operator handoff, and can seed the next dispatch goal so an
     operator can continue from a completed/failed run without rewriting
     the context by hand.
      The same detail pane can now promote a Fleet outcome into project
      memory as a `pattern`, which is the first small Cowork-facing step
      toward the Hermes-style learning loop. Fleet Command Center now
      also reloads recent Fleet outcome memories and can include them in
      the next dispatch goal, closing the first outcome -> memory ->
      dispatch-context loop.
      Cowork dispatch now also exposes a small Hermes-inspired profile
      selector (`balanced`, `research`, `code`, `review`, `safe`) that
      injects tool/posture guidance into the saga goal and persists the
      selected profile into saga/activity metadata. This is the first
      filtered-toolset ergonomics step without replacing the existing
      router. The task router now also uses that profile as a soft model
      selection signal: `research` favors long-context models, while
      `code`, `review` and `safe` favor reasoning-capable models. The
      same profile now travels through `peer.dispatch` into the remote
      dispatch state, where it applies a small profile-specific system
      guidance block. This gives Fleet a concrete hook for future
      Hermes-style filtered toolsets while keeping the current peer RPC
      contract backward-compatible. A shared core descriptor now also
      maps each Fleet profile to the existing Code Buddy tool-policy
      vocabulary (`minimal`, `coding`, `messaging`, `full`) and exposes
      allow/confirm/deny group hints in dispatch status. The descriptor
      now produces real `PolicyConfig` rules for the existing policy
      resolver, and `buddy fleet policy` can preview per-tool decisions
      before execution. `route_peer` and `peer_delegate` also accept the
      same dispatch profile, so the LLM-facing multi-peer path can route
      and answer with the selected posture. The profile now crosses the
      `peer.chat` RPC boundary and comes back as `toolPolicy`,
      `toolDecisions` and a `toolset` descriptor, with a loopback smoke proving the metadata
      survives real WebSocket transport. Enforcement can now be added
      behind that descriptor instead of inventing a second permission
      model. The same profile metadata now applies to multi-turn
      `peer.chat-session.start` flows and appears in Cowork peer details
      as active chat-session posture/turn metadata, while preserving the
      privacy rule that prompt and answer content never ride on fleet
      monitoring events. `buddy fleet toolsets` now turns the same
      resolver-backed policy into a Hermes-style toolset manifest with
      allowed, confirmed and denied tool names for the inspected profile.
      This makes the filtered-toolset boundary concrete for operators
      and future Cowork UI work without vendoring Hermes or introducing
      a parallel permission model. The same descriptor now travels
      through the LLM-facing `route_peer` result and peer chat/session
      metadata so downstream callers can key on `fleet.hermes.<profile>`
      instead of reverse-engineering policy groups.
      Code Buddy now also has a built-in custom-agent profile named
      `hermes`: it loads without a user TOML file, uses the native
      Hermes Agent system prompt, and can be inspected with
      `buddy hermes profile` or `buddy hermes agent <profile>`.
   - The Fleet Command Center chrome now has `en`, `fr` and `zh`
     translation coverage with a regression guard.
   - Defer SQLite saga tables until query/reporting needs are real.
8. Make internet access automatable and testable. Status: first
   Stagehand-inspired browser primitive pass implemented without adding
   a dependency.
   - `browser` now accepts `observe` for an accessibility snapshot that
     includes actionable and contextual page elements.
   - `browser` now accepts `extract` for a compact page-state readout
     with URL, title, headings, actions, links and query-focused matches.
   - `browser` now accepts `assert_text` so autonomous internet flows can
     leave an explicit pass/fail proof instead of only a screenshot or
     prose summary.
   - `buildInternetProofPlan` now gives Cowork/Fleet a pure, reusable
     plan object for `web_search` -> `web_fetch` -> `browser.observe`
     -> `browser.extract` -> `browser.assert_text` -> curated memory,
     with no browser or network side effects in the planner itself.
   - Next polish: surface this plan as visible Cowork/Fleet Activity Feed
     steps when a web automation run starts.

## Later roadmap

- External channel bridge inspired by Hermes/OpenClaw, after Fleet is
  stable.
- Optional memory provider plugins for Honcho-like user modeling.
- Optional Mem0-style provider adapter after the SQLite memory boundary
  is stable and after there is a real migration/test need.
- ACP/editor adapter if it helps the consulting/demo story.
- Rust expansion only for clear native boundaries: sidecar services,
  desktop/device integration, local indexing, audio/STT or performance
  sensitive helpers.
- Continue the historical naming cleanup by preferring
  `CODEBUDDY_HOME` while keeping `GROK_HOME` as a compatibility alias.

## What not to do

- Do not rewrite Code Buddy in Python.
- Do not vendor Hermes.
- Do not add a second agent runtime beside `CodeBuddyAgent` unless it
  has a strict boundary and a migration plan.
- Do not rebuild every Hermes gateway channel before the Fleet/Cowork
  product loop is comfortable.
- Do not blur the product: Code Buddy is the CLI, Fleet brain and Cowork
  cockpit for multi-LLM coding work.

## Strategic conclusion

Hermes confirms that the right target is bigger than a coding CLI: the
target is a durable agent workbench. But Code Buddy's advantage is its
own stack and Patrice's workflow:

- Windows-first.
- Cowork-first.
- Multi-LLM and Fleet-first.
- Consulting/demo friendly.
- Deep integration with GitNexus-style technical documentation work.

Use Hermes as a mature research-backed compass. Keep Code Buddy's
implementation identity.
