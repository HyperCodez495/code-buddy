# Rust daemon strategy — what to offload, and what NOT to rewrite

**Date: 2026-06-08.** Code Buddy is TypeScript/Node. Node is excellent at **I/O-bound** work (the agentic loop is mostly waiting on LLMs, files, sockets) and poor at **CPU-bound** work. The rule: **push CPU-heavy primitives into a native Rust daemon; keep the I/O glue in TS.**

We already have two native daemons, both newline-delimited JSON-RPC over stdin/stdout:
- **`codebuddy-sidecar`** — Whisper STT + desktop automation (`src-sidecar/`).
- **`codebuddy-captured`** — screen-frame perceptual hashing / dedup (`src-captured/`, this work). Reachable from Node via `src/capture/captured-bridge.ts`.

The same daemon pattern is the home for everything below.

## What ELSE a Rust daemon should offload (ranked by value)

Code Buddy's actual CPU-bound hot paths, with the crate to use:

| Offload | Why it's hot in Code Buddy | Rust crate(s) | Value |
|---|---|---|---|
| **Embeddings** | RAG tool selection (`src/codebuddy/tools.ts`) embeds the query every turn; memory + the screen index need them too | `fastembed-rs` (ONNX, bundles models) or `candle` | **High** — used constantly |
| **Vector search / ANN** | nearest-neighbour over tool/memory/frame embeddings | `usearch`, `hnsw_rs`, embedded `qdrant` | **High** |
| **Codebase indexing & search** | bug finder, RAG over files, BM25 `tool_search`, JIT context | `grep`/`ignore` (ripgrep), `tree-sitter` (AST), `tantivy` (full-text) | **High** on large repos |
| **Tokenization / token counting** | context manager counts tokens on every turn + compaction | `tokenizers` (HF, native) | **Med-High** |
| **Fuzzy string matching** | the edit tool's 5-strategy cascade (Levenshtein, LCS, fuzzy 10%) on big files | `strsim`, `triple_accel` | **Med** |
| **OCR** | the screen pipeline (`ScreenWatcher --ocr`) shells to tesseract per frame | `ocrs` (pure Rust) or `leptess` | **Med** (screen-specific) |
| **Perceptual hashing / dedup** | ✅ **done** — `codebuddy-captured phash/diff` | `image_hasher` | shipped |
| **Compression** | session/checkpoint + pre-compaction flush | `zstd` | Low-Med |

These share traits: CPU-bound, parallelizable, and slow in JS. They are **callable by both the CLI and the server** through the daemon bridge — which answers the next question.

## Would the SERVER benefit from being rewritten in Rust? — No.

`src/server/` (HTTP 3000 + Gateway WS 3001, `/api/chat/completions`, sessions, A2A, peer RPC, fleet) is **I/O-bound glue**: it proxies LLM calls and shuttles JSON/WS frames. The bottleneck is **provider latency + network**, not CPU — exactly where Node's event loop already shines. Rewriting it in Rust would:
- be a **huge effort** (re-implement every route, auth/JWT, WS, MCP, A2A, the OpenAI-compat surface),
- **sever the tight coupling** with the TS agent core (the agentic loop, 110+ tools, middlewares are all TS), and
- buy **little throughput** — the server spends its time awaiting, not computing.

**The only CPU-heavy things the server does** (token counting, embedding/vector ops in the RAG path, request validation at very high QPS, compression/TLS) are better served by the **shared daemon** than by a rewrite — the server calls the same `codebuddy-captured`/sidecar bridge the CLI does.

**Verdict:** keep the server (and the agent core) in TypeScript. Move the **compute** — not the glue — into the native daemon, and let both the CLI and the server call it. That is the architecture this work starts: TS orchestrates I/O; Rust does the heavy lifting.

## Next step (highest-value offload)

**Embeddings + vector search** (`fastembed-rs` + `usearch`) as `codebuddy-captured` methods (`embed`, `index.add`, `index.search`) — it would accelerate RAG tool selection, memory recall, and the screen "what did I see?" index in one move, all local/free.
