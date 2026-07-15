# Intent Ledger

The Intent Ledger turns a non-trivial task into a repository-local contract that can be checked again after the implementation has changed. It is a P0, CLI-only feature and is disabled unless `CODEBUDDY_INTENTS=true` is set.

## Intent format

Intents live in `.codebuddy/intents/<id>.md`. Their YAML frontmatter records the stable id, title, status (`active`, `done`, or `archived`), creation date, repository-relative files, and verification criteria. The Markdown body is free-form context and decisions.

```markdown
---
id: focused-login-tests-20260715
title: Focus login regression coverage
status: active
createdAt: '2026-07-15T10:00:00.000Z'
files:
  - src/auth/login.ts
  - tests/auth/login.test.ts
criteria:
  - desc: Focused login tests pass
    cmd: npm test -- tests/auth/login.test.ts
    expectExit: 0
---
## Context

Keep the regression contract beside the code.
```

Audit events are appended as JSON Lines to `.codebuddy/intents/ledger.jsonl`. Creation, checks, detected drift, and archival are never rewritten.

## CLI

```bash
CODEBUDDY_INTENTS=true buddy intents new "add focused login regression coverage"
CODEBUDDY_INTENTS=true buddy intents list
CODEBUDDY_INTENTS=true buddy intents show <id>
CODEBUDDY_INTENTS=true buddy intents check <id>
CODEBUDDY_INTENTS=true buddy intents done <id>
CODEBUDDY_INTENTS=true buddy intents drift
CODEBUDDY_INTENTS=true buddy intents archive <id>
```

`new` uses the currently resolved command provider to propose a title, likely files, and shell-verifiable criteria. Review the generated Markdown before treating it as a contract.

`check` runs every criterion from the repository root. Each command runs through a non-interactive `sh -c`, with stdin closed, no interactive shell option, and a mandatory timeout. `CODEBUDDY_INTENTS_TIMEOUT_MS` overrides the default of 120000 ms when it is a positive number. Criteria containing `sudo` are refused. The intent passes only when every expected exit code matches.

`drift` considers only intents marked `done`. It reports drift when a referenced path no longer exists inside the repository or when any criterion no longer returns its expected exit code.

Without the opt-in environment variable, every `buddy intents` action exits with status 1 before reading, generating, checking, or modifying intent state. The command implementation is lazy-loaded and is not part of the normal CLI hot path.
