# Onboarding: Hermes Agent vs Code Buddy

Status: 2026-06-12

## Hermes Baseline

Hermes presents onboarding as a staged path:

1. Install the CLI/desktop app.
2. Choose a provider. The fastest path is `hermes setup --portal`, which performs OAuth, selects a Nous model, and enables the Tool Gateway.
3. Run a first chat with an easy-to-verify prompt.
4. Verify session resume with `hermes --continue`.
5. Try key features such as terminal tools, slash commands, multiline input, and interrupts.
6. Add the next layer only after the base chat works: gateway/bots, tools, skills, sandboxing, voice, MCP, or editor integration.

Sources:

- https://hermes-agent.nousresearch.com/docs/getting-started/quickstart
- https://hermes-agent.nousresearch.com/docs/integrations/nous-portal
- https://hermes-agent.nousresearch.com/docs/user-guide/desktop
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/learning-path.md

## Code Buddy Gap Before This Change

`buddy onboard` was a shorter setup wizard:

1. Pick a provider.
2. Optionally type an API key.
3. Pick a model.
4. Optionally enable TTS.
5. Write `.codebuddy/config.json`.

The biggest mismatch was the ChatGPT path. Code Buddy already has first-class
ChatGPT OAuth through `buddy login` and `buddy whoami`, and the runtime can use
`gpt-5.5`; however, the wizard still treated `chatgpt` like an API-key provider
using `OPENAI_API_KEY` and `gpt-4o`.

It also did not turn setup into a verifiable path: no first-chat smoke prompt,
no session resume check, and no next-layer guidance.

## Code Buddy Improvement

The wizard now exposes a Hermes-style roadmap:

1. Install and diagnose with `buddy doctor`.
2. Choose provider and authenticate.
3. Run a verifiable first chat.
4. Verify session resume with `buddy --continue`.
5. Add the next layer after base chat works.

Provider setup is now mode-aware:

- `chatgpt`: OAuth, no API key prompt, default `gpt-5.5`, next commands `buddy login` and `buddy whoami`.
- API-key providers: env var guidance and `buddy doctor`.
- Local providers: local server command plus connectivity check.

The generated `.codebuddy/config.json` now includes deterministic onboarding
metadata with phase ids and recommended next commands, so future UI surfaces
can render the same path without duplicating wizard logic.
