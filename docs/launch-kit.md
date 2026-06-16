# Launch kit — copy-paste posts to grow stars

**Reality check (honest):** a great README *multiplies* traffic ~3–5×; it doesn't *create* it. From a low base, the order-of-magnitude jump comes from **distribution** — a front-page Hacker News post, an r/LocalLLaMA thread, a tweet that lands, an awesome-list inclusion. The agent made the repo maximally convertible; **the takeoff is a button *you* press.** Below is everything ready to paste.

**The wedge that works:** *free · local · you own it.* Lead with that everywhere. Let the demo GIFs carry the "wow" — don't name-compare to Cursor/Copilot (it invites "actually it's worse at X" pushback that derails threads).

**One link to rule them all:** `https://github.com/phuetz/code-buddy`

---

## 1. r/LocalLLaMA — your bullseye (post this first)

> **Title:** I built an open-source AI coding agent + desktop app that runs **free on local Ollama** — multi-AI fleet, 24/7 autonomy, and on-screen reasoning
>
> **Body:**
> I wanted a coding agent I actually *own* — no per-token bill, no cloud lock-in, runs on my own models. So I built **Code Buddy**: a terminal agent **and** an Electron desktop app (Cowork) on one engine.
>
> - **100% local & free** on Ollama (`$0`), or bring any of 15 providers with auto-failover.
> - **Reasoning you can watch** — the local model thinks step-by-step on screen, then uses tools (e.g. *"create robot-haiku.md"* → it reasons, writes the file, confirms — ~$0.0001 local). Short clips in the README.
> - **Multi-AI fleet** — peers on your network observe each other and call each other's models/tools.
> - **24/7 autonomous service** that claims & runs tasks free-first on local models.
> - ~110 tools, skills, MCP, voice + opt-in vision companion.
>
> MIT, TypeScript, 27K+ tests. Repo + demos: https://github.com/phuetz/code-buddy
>
> Genuinely after feedback — what would make this your daily driver locally?

*Tips: post Tue–Thu ~9–11am ET. Reply to every comment for the first 2h. Don't drop and run.*

---

## 2. Hacker News — Show HN

> **Title:** Show HN: Code Buddy – an open-source AI coding agent that runs free on local Ollama
>
> **First comment (post it yourself, right after submitting):**
> Author here. It's a terminal agent + an Electron desktop app on the same engine. The bit I'm proud of: it runs **fully local on Ollama for `$0`** (or any of 15 providers), shows the model's reasoning on screen, and can run **autonomously 24/7** claiming tasks free-first on local models. There's also a multi-AI "fleet" where peers call each other's models/tools over your network.
> MIT, TS, 27K+ tests, builds clean from source. Demos in the README. Happy to answer anything — especially keen on what breaks for you on a fresh clone.

*Tips: submit Tue–Thu ~8–10am ET. The title must be plain — no hype words. The first comment is where you sell it.*

---

## 3. X / Twitter thread

> **1/** I built an open-source AI coding agent that runs **free on your own machine** 🧵
> Terminal + a desktop app, one engine. Local Ollama = $0. Watch it reason, then act 👇
> [attach `docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif` — or the newer desktop chat-stream `docs/qa/code-buddy-studio/showcase-2026-06-16/cowork-chat-stream.gif` (real gpt-5.5 streaming at $0)]
>
> **2/** It's not just chat — it uses tools. *"create robot-haiku.md"* → the local model **thinks**, writes the file, confirms. ~$0.0001, no cloud.
>
> **3/** And it scales: a **multi-AI fleet** where peers observe each other and call each other's models/tools across your network. Plus a 24/7 autonomous service that runs tasks free-first on local models.
>
> **4/** 15 providers, ~110 tools, skills + MCP, voice + opt-in vision. MIT, TypeScript, 27K+ tests.
> ⭐ https://github.com/phuetz/code-buddy

---

## 4. Awesome-list submissions (slow burn, compounding)

Open a PR adding Code Buddy to each (1-line entry + link):
- `e2b-dev/awesome-ai-agents`
- `kyrolabs/awesome-agents` / `slavakurilyak/awesome-ai-agents`
- `Hannibal046/Awesome-LLM`
- `ollama/ollama` community/integrations list, and `awesome-ollama` repos
- `punkpeye/awesome-mcp-servers` (Code Buddy is an MCP client *and* server)
- Electron "awesome" + "awesome devtools" lists

Entry template:
> **[Code Buddy](https://github.com/phuetz/code-buddy)** — Open-source AI coding agent (terminal + desktop) that runs free on local Ollama, with a multi-AI fleet and 24/7 autonomy.

---

## 5. Other channels

- **dev.to / Hashnode** — a short build post: *"I built a local-first AI coding agent — here's the architecture."* Embed the demos.
- **Ollama Discord / r/ollama** — the local-AI crowd; lead with `$0` + the demo.
- **Product Hunt** — once polished; needs a launch-day push.
- **Your network** — the first 20 stars from people who'll actually try it beat 200 drive-by stars; they file issues and tell others.

---

## 6. Ready-to-publish blog post (dev.to / Hashnode)

> **Title:** I built a local-first AI coding agent that runs for $0 — here's why and how
>
> AI coding assistants are great until the bill arrives, or until you realize your codebase is round-tripping to someone else's cloud. I wanted one I **own**: runs on my own models, $0 marginal cost, no lock-in. So I built **Code Buddy** — and made it work the same from a terminal, a desktop app, a server, and a 24/7 background service, all on one engine.
>
> **The local-first bet.** Point it at Ollama and it's free. A small caveat I learned the hard way: not every local model can drive tools — some emit tool calls as plain text. So Code Buddy gates tool-calling per model (`getModelToolConfig`), uses tool-capable local models (qwen3.6, devstral) for agentic work, and keeps a free-first → escalate ladder so it only reaches for a paid API when local genuinely can't do the job.
>
> **Reasoning you can watch.** With a reasoning model, the thinking streams on screen before it acts — then it actually uses tools (e.g. *"create robot-haiku.md"* → it reasons, writes the file, confirms). ~$0.0001, fully local. [embed `cowork-demo-moneyshot.gif`]
>
> **Multi-AI fleet.** The part I find most fun: peers on your network observe each other's events live and can call each other's models and read-only tools (`peer.chat` / `peer.tool.invoke`), behind three security gates (allowlist → `fleetSafe` flag → fail-closed workspace root). One machine's spare GPU becomes everyone's.
>
> **Autonomous.** `buddy autonomy install` registers a background service that claims tasks off a shared queue (with TTL leases so a crashed agent's task auto-reclaims, DAG deps, and a workers→verifier→synthesizer swarm) and runs them free-first on local models.
>
> It's MIT, TypeScript, 27K+ tests, and builds clean from source. Repo + demos: https://github.com/phuetz/code-buddy — feedback very welcome.

*Tips: cross-post to dev.to, Hashnode, and your blog. Add tags: `ai`, `opensource`, `ollama`, `typescript`, `localllm`. Link it from the HN/Reddit threads as "more detail here."*

---

## Pre-flight (do these before any post — a broken first clone kills a launch)

- [x] `git clone … && npm install && npm run build && buddy --help` works (build verified ✅).
- [x] README hero demo renders + autoplays on github.com.
- [x] Cowork desktop showcase embedded (welcome, real-$0 chat-stream MP4/GIF, onboarding provider picker, fleet/autonomy) — `docs/qa/code-buddy-studio/showcase-2026-06-16/`.
- [x] No falsifiable badges (Coverage badge removed; Build/Tests verified).
- [ ] **Upload the social preview** — `docs/qa/code-buddy-studio/social-preview.png` (1280×640) in **repo Settings → Social preview**. This is the card shown whenever your link is shared on Reddit/X/Discord/Slack — it materially raises click-through. (GitHub only lets the owner set this; the agent built the image, you upload it.)
- [ ] Skim open issues; pin a friendly "good first issue" or two.
- [ ] Have the repo description + topics set (done) so search/awesome-bots find it.
