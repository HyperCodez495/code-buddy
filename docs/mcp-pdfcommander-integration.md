# PdfCommander MCP Integration

Drive PDF operations directly from the Code Buddy agent by registering
[PdfCommander](https://github.com/) as an [MCP](https://modelcontextprotocol.io)
(Model Context Protocol) server.

## What this is and why

PdfCommander ships a headless MCP server (`pdfcmd mcp-headless`) — a stdio
JSON-RPC process that exposes real, programmatic PDF operations (info, text
extraction, merge, split, watermark, redact, compare, encrypt, …) backed by
PDFsharp.

Once registered, Code Buddy connects to that server at session start, discovers
its tools, and can call them autonomously inside the agentic loop. The agent can
then merge, split, redact, or inspect PDFs as part of a normal task — no manual
CLI invocation needed.

> There is also a Code Buddy *skill* (`~/.codebuddy/skills/pdfcommander`) that
> wraps the PdfCommander CLI directly. Both work; the MCP route is the cleaner
> programmatic channel because the agent gets typed tools with input schemas and
> structured results rather than parsing CLI text.

## Where Code Buddy loads MCP servers

Code Buddy reads MCP server definitions from these files, in priority order
(see [`src/mcp/config.ts`](../src/mcp/config.ts) → `loadMCPConfig()`):

1. Project: `.codebuddy/mcp.json` (highest priority; committable, shareable with a team)
2. Project settings: `.codebuddy/settings.json` → `mcpServers`
3. User: `~/.codebuddy/mcp.json` (lowest priority; machine-wide)

For a tool you use across projects, register it once in `~/.codebuddy/mcp.json`.

## The `mcp.json` schema

The schema is defined by `MCPServerConfig` in
[`src/mcp/types.ts`](../src/mcp/types.ts) and `TransportConfig` in
[`src/mcp/transports.ts`](../src/mcp/transports.ts). The file has a top-level
`mcpServers` object (the legacy key `servers` is also accepted), keyed by server
name. Each entry has these fields:

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Server name (matches the map key). |
| `transport` | object | Connection config. **Required** by the type. See below. |
| `transport.type` | `'stdio' \| 'http' \| 'sse' \| 'streamable_http'` | PdfCommander uses `stdio`. |
| `transport.command` | `string` | Executable to launch (stdio only). |
| `transport.args` | `string[]` | Arguments passed to the command (stdio only). |
| `transport.env` | `Record<string, string>` | Extra environment variables for the child process. |
| `transport.url` | `string` | Endpoint URL (http / sse transports only). |
| `transport.headers` | `Record<string, string>` | HTTP headers (http / sse transports only). |
| `enabled` | `boolean` (optional) | Defaults to `true`. Set `false` to keep the entry but skip it at load time. |
| `autoReconnect` | `boolean` (optional) | Reconnect if the connection drops. |
| `maxRetries` | `number` (optional) | Max reconnection attempts. |

Notes:

- Use the **nested `transport`** form shown here — it matches the `MCPServerConfig`
  type. A flat top-level `command` / `args` / `env` form is tolerated for legacy
  configs, but prefer the nested form.
- `transport.env` values support `${ENV_VAR}` substitution, resolved from
  `process.env` at load time (see `resolveEnvVars()` in `src/mcp/config.ts`). An
  unset variable resolves to an empty string.

## Register PdfCommander

Add this entry to `~/.codebuddy/mcp.json` (create the file if it does not exist).
Replace the placeholder paths with your real ones:

```json
{
  "mcpServers": {
    "pdfcommander": {
      "name": "pdfcommander",
      "transport": {
        "type": "stdio",
        "command": "/path/to/dotnet",
        "args": ["/path/to/pdfcmd.dll", "mcp-headless"],
        "env": {
          "DOTNET_ROOT": "/path/to/.dotnet"
        }
      },
      "enabled": true
    }
  }
}
```

What the placeholders mean:

- `command` — the `dotnet` host that runs PdfCommander (or a native `pdfcmd`
  binary, in which case the first `args` entry is just `mcp-headless`).
- `args` — `["<path>/pdfcmd.dll", "mcp-headless"]` launches the headless MCP
  server over stdio.
- `env.DOTNET_ROOT` — point this at your .NET installation if `dotnet` is not
  already on a globally resolvable `DOTNET_ROOT`.

You can also register it from the CLI instead of editing JSON by hand:

```bash
buddy mcp add-json pdfcommander \
  '{"transport":{"type":"stdio","command":"/path/to/dotnet","args":["/path/to/pdfcmd.dll","mcp-headless"],"env":{"DOTNET_ROOT":"/path/to/.dotnet"}}}'
```

(`buddy mcp add-json` writes to the **project** `.codebuddy/settings.json`, asks
for a security confirmation because it launches a local command, and then tries
to connect immediately.)

## Verify it connected

The `buddy mcp` command (see [`src/commands/mcp.ts`](../src/commands/mcp.ts))
exposes: `add`, `add-json`, `remove`, `list`, `test`.

To confirm the connection works and see the discovered tools, use **`test`** —
it actively opens the connection (`manager.addServer()`) and enumerates the
tools:

```bash
buddy mcp test pdfcommander
```

Expected output:

```
Testing connection to pdfcommander...
✓ Successfully connected to pdfcommander
  Available tools: <N>
  Tools:
    - info: ...
    - merge: ...
    - split: ...
    ...
```

`buddy mcp list` shows the configured-server inventory with a connection status
and tool count:

```bash
buddy mcp list
```

Note: `list` reflects the *current* manager state rather than forcing a fresh
connect, so in a bare CLI invocation it may show `✗ Disconnected` until a
session (or `buddy mcp test`) has opened the connection. Use `test` when you
want a definitive "it connected" check.

## Available tools and capability discovery

Inside the agent, PdfCommander tools surface under the namespaced form
`mcp__pdfcommander__<tool>` (the `list` / `test` display strips the
`mcp__pdfcommander__` prefix). Typical tools exposed by `mcp-headless`:

| Tool | Purpose |
|---|---|
| `info` | Read PDF metadata (page count, title, sizes, …). |
| `extract_text` | Extract text content. |
| `merge` | Combine multiple PDFs into one. |
| `split` | Split a PDF into multiple files. |
| `watermark` | Apply a text/image watermark. |
| `redact` | Redact regions / patterns. |
| `compare` | Diff two PDFs. |
| `encrypt` | Password-protect / set permissions. |
| `capabilities` | Report what this build supports. |

The authoritative list always comes from the live server — run
`buddy mcp test pdfcommander` to see exactly what your PdfCommander build
exposes.

For discovery before wiring anything up, PdfCommander's own CLI reports its
capabilities as JSON:

```bash
pdfcmd doctor          # environment / readiness diagnostics
pdfcmd capabilities    # JSON list of available operations
```

An agent (or you) can run these first to learn what's available before calling
the MCP tools.

## Worked example

With the server registered and verified, start a normal session and ask the
agent to do PDF work. It will pick the right `mcp__pdfcommander__*` tools on its
own:

```
buddy
> Merge ./invoices/jan.pdf, ./invoices/feb.pdf and ./invoices/mar.pdf into
  ./invoices/q1.pdf, then tell me the page count of the result.
```

The agent will call `mcp__pdfcommander__merge` to produce `q1.pdf` and
`mcp__pdfcommander__info` to report the page count — all without leaving the
session.

## Troubleshooting

- **Server saved but connection failed** — re-run `buddy mcp test pdfcommander`
  to see the error. Most failures are a wrong `command` path or a missing
  `DOTNET_ROOT`.
- **`Command is required for stdio MCP transport`** — `transport.command` is
  empty; fill in the path to `dotnet` (or the `pdfcmd` binary).
- **No tools listed** — the process started but isn't speaking MCP; confirm the
  args end with `mcp-headless` and that `pdfcmd doctor` reports a healthy build.
