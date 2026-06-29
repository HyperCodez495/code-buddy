# Council Scientific Notes

Source-backed design notes for the `buddy council` collective-intelligence path.

## Papers Worth Tracking

- **Mixture-of-Agents Enhances Large Language Model Capabilities** (`arXiv:2406.04692`) — motivates a layered aggregator: multiple model outputs first, then a final synthesis model that composes the strongest answer. Council maps this to conductor roles + final synthesis.  
  <https://arxiv.org/abs/2406.04692>

- **Improving Factuality and Reasoning in Language Models through Multiagent Debate** (`arXiv:2305.14325`) — early evidence that independent agents can critique and improve reasoning when a judge/aggregator resolves disagreements. Council keeps an impartial judge before synthesis.  
  <https://arxiv.org/abs/2305.14325>

- **Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate** (`arXiv:2305.19118`) — useful reminder that diversity matters: agents should not all receive the same framing. Council uses complementary roles for complex tasks.  
  <https://arxiv.org/abs/2305.19118>

- **Stop Overvaluing Multi-Agent Debate -- We Must Rethink Evaluation and Embrace Model Heterogeneity** (`arXiv:2502.08788`) — critical paper arguing that debate gains depend on task/evaluation setup and model heterogeneity. Council therefore keeps direct fan-out for simple prompts, caps timeouts, and exposes `--no-conductor` / `--no-synthesis`.  
  <https://arxiv.org/abs/2502.08788>

- **Should we be going MAD? A Look at Multi-Agent Debate Strategies for LLMs** (`arXiv:2311.17371`, ICML 2024) — benchmarks debate strategies and shows that cost, time, agreement level, and prompting hyperparameters matter. Council keeps the protocol one-round by default and avoids unbounded debate loops.  
  <https://arxiv.org/abs/2311.17371>

- **AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation** (`arXiv:2312.13010`) — code-oriented evidence for programmer/tester/reviewer style separation. Council's code role set mirrors this: architect, implementer, reviewer, verifier.  
  <https://arxiv.org/abs/2312.13010>

- **MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework** (`arXiv:2308.00352`) — strong software-engineering pattern: encode collaboration as role/process structure rather than free-form chat. Council uses fixed role missions and focus lists.  
  <https://arxiv.org/abs/2308.00352>

- **ChatDev: Communicative Agents for Software Development** (`arXiv:2307.07924`) — supports role-based software collaboration, but also warns implicitly that coordination overhead must stay bounded. Council uses one round by default.  
  <https://arxiv.org/abs/2307.07924>

- **Sakana Fugu Technical Report** (`arXiv:2606.21228`) — practical orchestration pattern: choose models/agents, assign subtasks, and control aggregation instead of broadcasting the same request. Council's conductor is the first deterministic version of this pattern.  
  <https://arxiv.org/abs/2606.21228>

## Current Council Design

- Route by capability and learned win rate.
- Prefer model/provider diversity before adding duplicate providers.
- For complex tasks, assign complementary roles instead of identical prompts.
- Run a bounded parallel answer round.
- Use an impartial judge to score anonymized candidates.
- Use a final synthesis pass to merge role-specialized contributions.
- Compute a decision-confidence signal from judge margin, winner score, and lexical agreement.
- Pass dissent/confidence cues into synthesis when agreement is low, scores diverge, or roles are complementary.
- Keep lexical consensus as a weak diagnostic signal, not as the verdict.
- Record the judge outcome in the model scoreboard by task type.
- Record the role played by each answer, then use role-specific score history to assign future roles.

## Next Research-Driven Upgrades

- Add a cheap contradiction detector before synthesis, so the synthesizer receives explicit disagreements.
- Add optional two-round debate only when judge confidence is low or lexical divergence is high.
- Add a budget policy: skip synthesis or remote peers for trivial tasks, high latency, or expensive providers.
