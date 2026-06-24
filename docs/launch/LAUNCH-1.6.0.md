# Code Buddy 1.6.0 — Launch kit

> Draft prepared autonomously 2026-06-24. Built entirely on features **validated
> live tonight** on a real daemon (no vaporware). Review before posting; nothing
> here has been published.

The hook that landed tonight: **Patrice talked to his AI assistant from his phone,
it answered by voice, drew a live GDP chart and sent it back — all running free on
his own machine.** That's the story. Everything below is true and reproducible.

---

## 1. The one-liner

> **Code Buddy** — an open-source AI coding agent you can also *talk to from your
> phone*. Voice in, voice out, charts back, your own machine, `$0`. No cloud lock-in.

## 2. Show HN post

**Title:** `Show HN: I talk to my coding agent by voice from my phone — it runs free on my own machine`

**Body:**

> Code Buddy is an open-source AI agent (TypeScript, MIT). The part I want to show
> isn't the IDE integration — it's that I reach the *same* agent from Telegram:
>
> - I send a voice note → it transcribes locally (faster-whisper), thinks, and
>   **replies with a voice note** (Piper TTS). Zero cloud for the voice, `$0`.
> - "draw France's GDP over 20 years" → it writes Python, runs it via `uv`
>   (matplotlib), and **sends the PNG back to the chat**.
> - It runs **multiple bots with isolated memory** — "Lisa" and "Laura" don't share
>   each other's `remember` facts or conversations.
> - Sensitive actions aren't auto-run: it asks me to **`/approve <id>` over Telegram**
>   (human-in-the-loop), while safe reads go straight through.
> - It can explore my codebase (a knowledge graph over 87 indexed repos).
>
> The brain is pluggable: local Ollama (`$0`), or a flat-fee ChatGPT/Grok login (no
> per-token API bill). Tonight's demo ran on GPT-5.5 via a ChatGPT subscription —
> marginal cost `$0.0000`.
>
> Repo: <github.com/phuetz/code-buddy> · `npm i -g @phuetz/code-buddy`
>
> Happy to go into how the remote-approval flow + per-bot memory isolation work.

**Why this works:** it's concrete, reproducible, `$0`/local-first (HN loves
anti-cloud-lock-in), and the "voice + chart back from your phone" is a vivid demo.

## 3. X / Twitter thread

1/ I can now **talk to my coding agent from my phone** — and it talks back. 🎙️
Voice note in → it answers by voice. Ask for a chart → it draws it and sends the
image. All free, on my own machine. Open source. 🧵

2/ The voice is **100% local** ($0): faster-whisper for speech→text, Piper for
text→voice. No cloud, no API meter. It works offline.

3/ "trace France's GDP over 20 years" → it writes Python, runs matplotlib via `uv`,
saves a PNG, and **sends it back in the chat**. [chart image]

4/ It runs **several bots with separate brains** — Lisa and Laura have isolated
memory and distinct personas. What you tell one, the other doesn't know.

5/ Safety: it doesn't auto-run dangerous stuff. It asks **/approve** over Telegram —
human in the loop — while safe reads (list files, search code) go straight through.

6/ The model is your choice: free local Ollama, or a flat-fee ChatGPT/Grok login
(no per-token bill). Tonight: GPT-5.5, marginal cost $0.0000.

7/ Open source (MIT): github.com/phuetz/code-buddy — `npm i -g @phuetz/code-buddy`.
It's part of a trilogy with Code Explorer (code knowledge-graph) + lm-resizer
(context compression).

## 4. Reddit (r/LocalLLaMA, r/selfhosted) — short

**Title:** `Talk to your coding agent by voice from your phone — open source, runs on your own box ($0 local option)`

> Built a Telegram bridge to my open-source agent (Code Buddy). Send a voice note →
> faster-whisper transcribes locally → it answers, optionally **by voice** (Piper).
> Ask for a chart → matplotlib via `uv` → it sends the PNG. Multi-bot with isolated
> per-bot memory, and remote `/approve` for sensitive ops (no blind auto-exec).
> Brain = local Ollama ($0) or a flat-fee ChatGPT/Grok login. MIT.
> Repo + install in comments.

## 5. README / site additions (suggested, not yet applied)

Add to the "Personal companion" / "Runs everywhere" sections:

- 🎙️ **Two-way voice over Telegram** — voice note in (faster-whisper), voice note
  out (Piper), fully local, `$0`. Mirrors the user's modality.
- 📊 **Artifacts back** — generates charts/files and delivers images to the chat.
- 🤖 **Multi-bot, isolated** — run several bots (distinct personas) with separate
  memory + conversations.
- 🔐 **Remote approval** — sensitive tools ask `/approve <id>` over the channel;
  safe reads auto-run. Human-in-the-loop autonomy.

(Captures to grab once the demo is replayed: the GDP chart in Telegram, a
voice-note exchange, an approval prompt.)

## 6. What's technically new in 1.6.0 (for the release notes)

See `CHANGELOG` 1.6.0. Headline: remote tool-approval over messaging channels,
image/artifact delivery, per-bot memory isolation hardening, MCP init robustness
(per-server timeout), configurable MCP deferral, and channel-provider support for
ChatGPT-OAuth / Gemini-CLI.

## 7. Honesty notes (keep the launch credible)

- Voice + chart delivery require local engines (faster-whisper, Piper, ffmpeg, uv);
  they degrade gracefully to text when absent. Say so — don't imply out-of-box voice.
- The "$0" is the marginal/local cost; a flat-fee subscription (ChatGPT/Grok) or
  local Ollama is what makes it $0-per-use, not free infrastructure.
- Multi-bot isolation covers conversations + `remember` memory; lessons (auto-learned
  patterns) still share a global store — note as a known limitation / roadmap.
