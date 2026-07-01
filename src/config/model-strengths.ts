/**
 * Model strengths taxonomy — the single vocabulary for "what is this model
 * good at", used by the council router, the fleet task router and the
 * latency-aware selector.
 *
 * Lives in `config/` (not `fleet/`) because `model-tools.ts` is the single
 * source of truth for per-model capabilities and must be able to type its
 * `strengths` field without importing from `fleet/` (the dependency direction
 * is fleet → config). `src/fleet/types.ts` re-exports this type so existing
 * importers keep working.
 *
 * @module config/model-strengths
 */

export type ModelStrength =
  | 'reasoning'      // strong CoT, research, complex planning (Claude Opus, GPT-5, qwen3.6:35b-a3b)
  | 'vision'         // multimodal images (Gemini Pro Vision, Claude 3+, GPT-4o)
  | 'code'           // code generation / refactoring (Codex, qwen-coder, Claude)
  | 'long-context'   // 128k+ context window comfortably (Gemini Pro, Claude 200k)
  | 'cheap'          // <$0.5/Mtok input — good for parallel workers (Haiku, gemma4, Mistral Tiny)
  | 'fast'           // <500ms p50 first token (Haiku, gpt-5-mini, gemma4:8b)
  | 'tool-calling'   // reliable structured tool calls
  | 'french'         // strong native French quality (Mistral, qwen3.6 fine-tunes)
  | 'thinking';      // extended-thinking budget (Claude, qwen-thinking)
