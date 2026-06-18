# Proof it works — real, reproducible, `$0`

Every claim below is a **real run on a normal laptop** against **free local models** (Ollama).
No cloud, no API key, no mocks — **cost `$0.0000`**. Each proof ships the **exact command** so you
can reproduce it.

> Captured 2026-06-18. **Setup:** install Ollama, `npm install` in this repo, and
> `export CODEBUDDY_PROVIDER=ollama` (this forces the local model — an active ChatGPT login would
> otherwise take priority).
>
> **Which model?** Use a **tool-capable** model — the `qwen3` family emits real tool calls
> (`ollama pull qwen3:8b`); `qwen2.5*` is chat-only. Chat, goal mode, and the autonomy loop run fine
> on 8B. **Multi-step agentic coding** (Proof 1) is markedly more reliable on a **capable** model
> (≈30B) — a small model will often flail and shell out instead of editing files. And every local
> model needs **room for the tools**: raise Ollama's context so the system prompt + tool schemas fit,
> e.g. start the server with `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`. (The default `4096` silently
> truncates the agentic loop.)

---

## 1. A local model writes real code **and a passing test** — `$0`

```bash
CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://localhost:11434 \
  buddy -d ./scratch --permission-mode acceptEdits --model qwen3.5-ctx32k \
  -p "Create fizzbuzz.mjs exporting fizzbuzz(n) (FizzBuzz rules). Create fizzbuzz.test.mjs \
that exits 0 only if fizzbuzz(15)==='FizzBuzz' && fizzbuzz(3)==='Fizz' && fizzbuzz(5)==='Buzz' \
&& fizzbuzz(1)==='1', else exits 1. Then run 'node fizzbuzz.test.mjs' and report the exit code."
```

> Captured on `qwen3.5-ctx32k` — a context-extended ~35B-class qwen3 (see **Which model?**). On a
> tiny model this multi-step task is unreliable — an honest limitation of small local models, not of
> Code Buddy. Goal mode and the lighter proofs below run fine on an 8B.

The agent **used real tools** — two `create_file` calls and one `bash` call — then reported back:

```
[notification] create_file completed   (fizzbuzz.mjs)
[notification] create_file completed   (fizzbuzz.test.mjs)
[notification] bash completed          (node fizzbuzz.test.mjs)
Token usage: [tokens: 2,914 in / 255 out | cost: $0.0000]
Done. Exit code: 0 (tests passed).
```

What it actually wrote (`fizzbuzz.mjs`):

```js
export function fizzbuzz(n) {
  if (n % 15 === 0) return 'FizzBuzz';
  if (n % 3 === 0) return 'Fizz';
  if (n % 5 === 0) return 'Buzz';
  return String(n);
}
```

**Independent check** (run by a human, not the agent): `node fizzbuzz.test.mjs` → **exit `0`**. ✅
Real files on disk, real test, **`$0.0000`**.

---

## 2. Goal mode — the agent keeps going until a **judge model** says it's done

```bash
CODEBUDDY_PROVIDER=ollama buddy -d ./scratch --permission-mode acceptEdits --model qwen3:8b \
  goal "Create a file PROOF.txt whose contents are exactly the word WORKS." --max-turns 2
```

```
⊙ Goal set (2-turn budget): Create a file named PROOF.txt …
goal judge: verdict {"verdict":"done","reason":"The response shows the file PROOF.txt was
  created with the exact content 'WORKS' (no newline)."}
✓ Goal achieved.
```

`PROOF.txt` on disk contains exactly `WORKS` — produced by a small **8B** local model. A separate
**LLM judge** (not the worker) gates completion: the Ralph-style autonomous loop, running for `$0`. ✅

---

## 3. The desktop app — **zero to first chat**, real and local

The Cowork GUI's first-run wizard, driven end-to-end on a real Electron boot and captured as
screenshots ([full walkthrough →](getting-started.md#onboarding-the-cowork-gui-ollama-0)).
The last step is a **real reply from local Ollama at `$0.0000`**:

![Cowork first response — real local Ollama reply, $0](assets/onboarding/07-first-response.png)

Reproduce the captures yourself:

```bash
cd cowork && COWORK_ONBOARDING_SHOTS=1 npx playwright test e2e/onboarding-ollama-screens.spec.ts
```

---

## 4. The autonomous fleet loop — unattended, **free-first**

```bash
buddy autonomy tasks add "Write a 3-line haiku about disk space" --dir ./fleet
CODEBUDDY_LOCAL_MODEL=qwen2.5:7b-instruct buddy autonomy run --max-ticks 1 --dir ./fleet --json
```

```json
{ "ticks": 1, "outcomes": { "completed": 1 } }
```

A real artifact the loop produced, unattended, for `$0`:

```
Bytes dance in light,
Hard drive sings with saved memories—
Space slips like time.
```

The loop claims a task, runs it on the cheapest model that can, and records the outcome — the
substrate for a 24/7 free-first fleet. ✅

---

## 5. Fifteen providers, **one routing path**

The runs above hit a local Ollama through Code Buddy's OpenAI-compatible router. The **same path**
reaches any of 15 providers — you only change the base URL / model / key:

```bash
buddy -p "explain this repo" --base-url https://api.groq.com/openai/v1     --model llama-3.3-70b-versatile
buddy -p "explain this repo" --base-url https://api.together.xyz/v1        --model meta-llama/Llama-3.3-70B-Instruct-Turbo
buddy login   # ChatGPT OAuth — $0 marginal cost via the Codex backend, no API key
```

No lock-in: local for `$0`, or any cloud provider with automatic failover.

---

## 6. It's not a toy — **~27K tests**

```bash
npm run validate     # lint + typecheck + the full Vitest suite (~27K tests)
```

GA-tagged (`v1.1.0`), TypeScript strict, ~27K Vitest tests covering the agent loop, 15 providers,
the fleet hub, and the Cowork desktop app.

---

### Reproduce the whole thing for `$0`

```bash
# 1. a free local brain (tool-capable + room for the tools)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b
OLLAMA_CONTEXT_LENGTH=16384 ollama serve &      # the default 4096 truncates the agentic loop
# 2. Code Buddy
npm install -g @phuetz/code-buddy
# 3. force local + go
CODEBUDDY_PROVIDER=ollama buddy -p "build me a CLI todo app with a test"
```

> For heavier, multi-step coding, point `--model` at a more capable local model (≈30B+) or a
> cloud provider — see **Which model?** at the top. Small models are great for chat, goal mode,
> and the autonomy loop; they get less reliable as the task gets longer.

Found something that doesn't reproduce? [Open an issue](https://github.com/phuetz/code-buddy/issues)
— these are real runs, and we want them to stay that way.
