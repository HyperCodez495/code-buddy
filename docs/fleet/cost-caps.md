# Fleet cost caps

Inbound `peer.chat` and `peer.chat-session.continue` calls are limited before
they reach the local LLM. The caller's `maxTokens` is capped, the maximum call
cost is checked against the fleet ledger, and successful calls are charged
from their reported token usage.

| Environment variable | Default | Meaning |
|---|---:|---|
| `CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL` | `4096` | Maximum output tokens per inbound call |
| `CODEBUDDY_FLEET_MAX_DAILY_USD` | `5` | Maximum fleet spend per UTC day |
| `CODEBUDDY_FLEET_MAX_SAGA_USD` | `1` | Maximum spend for one propagated `traceId` |

Missing or invalid values use these conservative defaults; they never mean
unlimited. A zero dollar budget disables metered inbound calls. Budget or
ledger failures reject the request (`FLEET_BUDGET_EXCEEDED`,
`FLEET_BUDGET_CHECK_FAILED`, or `FLEET_COST_CHARGE_FAILED`) rather than
bypassing accounting. If provider usage is absent or invalid, the conservative
pre-call estimate is charged.
