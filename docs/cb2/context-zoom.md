# Context zoom

Context zoom makes compacted conversation summaries recoverable. It is disabled by default and does not alter the existing compaction output until explicitly enabled.

## Enable it

Set the feature flag before starting Code Buddy:

```bash
export CODEBUDDY_CONTEXT_ZOOM=true
```

An optional per-session retention limit controls archive size:

```bash
export CODEBUDDY_CONTEXT_ZOOM_MAX_MB=200
```

The default limit is 200 MB. When a session exceeds the limit, its least-recently-used segment files are removed first.

## How it works

When compaction replaces original messages with a summary, Code Buddy writes the exact messages to:

```text
~/.codebuddy/context-archive/<sessionId>/<segmentId>.json
```

The segment identifier is a stable short SHA-256 hash of the serialized messages. Writes use a temporary file followed by an atomic rename. A successful summary is prefixed with a marker such as:

```text
[segment:8f26b11e31a4c092] [Conversation Summary]
```

If directory creation, writing, renaming, or retention cleanup fails, compaction continues. No marker is added unless the archive is available, so a storage failure never creates a dangling recovery reference.

## Expanding a segment

With context zoom enabled, the `context_expand` tool is exposed to the model. It accepts:

- `segment_id` (required): the identifier copied from a `[segment:…]` marker.
- `max_tokens` (optional): response budget, default 4000 and capped at 8000.

The tool returns the archived messages as readable role/content blocks. It can only read the active conversation's session directory; it does not search or expand segments belonging to another session. Unknown and expired segments return a normal tool error.

Nested compaction remains recoverable: expanding an outer segment can reveal an earlier `[segment:…]` marker, which can then be expanded in turn.

## Privacy and operations

Archived segments contain the exact original conversation and are private local data. `context_expand` is deliberately not fleet-safe. Disable the flag to remove the tool from the model-facing tool list and restore byte-identical legacy summary output. Existing archive files are retained until the quota purges them or they are removed manually.
