# Cowork visual workflows

The Cowork **WorkflowEditor** lets users build a visual DAG and run it. The
runtime in this directory wraps the core multi-agent
**`Orchestrator`** (`src/orchestration/orchestrator.ts`) — the visual DAG is
compiled into the core `WorkflowDefinition` shape, then executed by the
orchestrator with a custom worker pool that fulfils tool/approval steps.

## Pipeline

```
visual DAG (nodes + edges)
        │
        ├─ workflow-bridge.ts    persists to <userData>/workflows/workflows.json
        │
        ▼
  dag-compiler.ts                 → core WorkflowDefinition
        │
        ▼
  Orchestrator.startWorkflow()   (multi-step, parallel/conditional aware)
        │
        ├─ task_assigned (agentId starts with cowork-tool-runner)
        │       │
        │       ▼
        │   CoworkToolAgent.runToolInvoke()    (FormalToolRegistry)
        │   CoworkToolAgent.runApprovalWait()  (renderer IPC)
        │
        ▼
  workflow.event / workflow.approval_required → renderer store
```

## Node types & expected `config`

| Node type   | Required config keys                 | Compiled to                              |
| ----------- | ------------------------------------ | ---------------------------------------- |
| `start`     | —                                    | (transparent — not emitted)              |
| `end`       | —                                    | (terminates the chain)                   |
| `tool`      | `toolName: string`, `toolInput: Record<string, unknown>` | `step.type='task'`, `task.type='tool_invoke'` |
| `condition` | `expression: string`                 | `step.type='conditional'` with true/false branches |
| `parallel`  | —                                    | `step.type='parallel'` with N branches   |
| `approval`  | `message?: string`, `timeoutMs?: number` (default 60 s) | `step.type='task'`, `task.type='approval_wait'` |

## V1 limitations

1. **No convergence after a `parallel` block.** Each branch must flow to
   `end` (or a downstream `parallel`/`condition`). Joining branches before
   `end` is not supported in V1 — the compiler will reject ambiguous
   topologies (`parallel` and `condition` are "leaf" steps of the main
   chain).
2. **`condition` requires labelled edges.** The two outgoing edges from a
   `condition` node must be labelled `'true'` and `'false'`. The compiler
   throws `CompilationError` otherwise.
3. **`condition` expressions** go through the core
   `safeEvalCondition` (`src/sandbox/safe-eval.ts`) — only a whitelist of
   operators is allowed. Reference upstream task outputs as
   `$task_<nodeId>` (the orchestrator stores task outputs in the workflow
   context as `task_<id>`).
4. **One workflow at a time.** The bridge tracks a single active run for
   instanceId↔workflowId mapping. Concurrent workflow runs from the same
   user will see swapped event tagging.
5. **Tool node config is free-form JSON.** The Inspector accepts any JSON
   for `toolInput`; it isn't validated against the tool schema until the
   agent invokes it. A failure surfaces as `node_failed` with the
   registry's error message.
6. **Approval timeout is hard.** When a timeout fires, the task is failed
   and the workflow as a whole fails. There is no "retry approval".

## Running a workflow end-to-end manually

```bash
npm run build:gui            # ~3 min
buddy install-gui && buddy gui
```

In the Settings → Workflows panel, build one of the smoke workflows from
`docs/migration.md` (or `cowork/tests/workflow-bridge-compilation.test.ts`
for the JSON shapes). Hit **Save**, then **Run**. The canvas will color
nodes as the orchestrator progresses (running = pulsing blue,
completed = green, failed = red).

## Testing

Unit tests cover the pure pieces:

- `cowork/tests/workflow-bridge-compilation.test.ts` — DAG → core
  conversion (linear, parallel, conditional, approval, error cases).
- `cowork/tests/cowork-tool-agent.test.ts` — agent dispatch +
  approval lifecycle (approve, reject, timeout, cancel).

End-to-end execution against a real `Orchestrator` + `FormalToolRegistry`
is covered by the smoke E2E above. We don't ship a Vitest e2e for now
because it would require a full Electron + core boot.
