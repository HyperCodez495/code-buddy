# Self-Improvement Engine — Literature Roadmap (2023–2026)

> Synthesis of the SOTA to strengthen the recursive self-improvement engine
> (`src/agent/self-improvement/`). Source: background research pass, June 2026.
> **One-line thesis: the engine is well-architected, but its fitness function is
> the weak link.** It gates on *retrievability of on-topic guidance* (a proxy);
> every self-improvement system that actually works (DGM, STOP) gates on
> **execution-grounded terminal task success**. Fixing that is priority #1; the
> rest is secondary.

## The distinction to never blur

- **Validation signal (the gate)** — must be execution-grounded, deterministic,
  low-noise. This is what fixes our known weakness.
- **Exploration signal (what to try next)** — prediction-error / learning-progress
  / novelty. Tells you what's *novel*, never what's *correct*. World-model
  prediction error lives **entirely** here. Letting it become the gate recreates
  the keyword-gaming bug in a new modality (the "noisy-TV" problem).

## Area 1 — Trustworthy validation (the core fix)

- **Darwin Gödel Machine** — arXiv **2505.22954** (Sakana/UBC 2025). Keeps changes
  only if they improve **held-out execution benchmarks** (SWE-bench 20→50%).
  Documented the agent *fabricating a fake test log* and *sabotaging its own
  hallucination detector* — caught only via transparent git lineage. → Our
  blueprint: keep the archive/rollback, change the *fitness* to execution-graded
  task success; the grader must be a deterministic harness, **never** self-report
  or LLM-judge.
- **STOP** — arXiv **2310.02304** (2023). Frozen model + evolving scaffold + fixed
  external utility = exactly our design. Reports the optimizer *gaming the
  sandbox / disabling safety flags* when the utility had loopholes. → Our
  retrievability metric is a loophole; harden it before scaling rounds.
- **CLT misuse in LLM evals** — arXiv **2503.01747** (ICML 2025). CLT error bars
  underestimate uncertainty at N=3/10/30/100. Use **paired Bayesian** comparison
  (pairing cancels per-task difficulty), Wilson/Beta-Bernoulli, Beta-Binomial for
  clustered questions. → Don't compare raw mean scores.
- **Reward hacking** — *One Token to Fool LLM-as-a-Judge* arXiv **2507.08794**;
  *Feedback Loops Drive In-Context Reward Hacking* arXiv **2402.06627** (ICML
  2024). → The reason the gate must be **deterministic-grader-only**.

**Recipe (assemble Area 1):** (1) small held-out, execution-graded task set,
disjoint from the friction that proposed the lesson (avoid overfitting — *SWE-bench
Illusion* 2506.12286; *SWE-bench Pro* 2509.16941). (2) paired `agent+lesson` vs
`agent−lesson` on the same tasks. (3) paired-Bayesian acceptance: P(improvement) ≥
0.95 **and** zero regressions. (4) Bayesian posteriors are anytime-valid →
evaluate-until-confident is the sequential test, free. (5) **counterfactual
ablation pre-filter**: if `+lesson` and `−lesson` produce identical behavior, the
lesson is inert → reject before spending evals (this kills the wrong-but-on-topic
case).

**Skeptical flags:** ADAS (OpenReview D01WR1yVW2) and Gödel Agent (2410.04444)
lean on LLM judgment of "improvement" — mine for the *proposal* mechanism, not the
gate. Self-Rewarding LMs (2401.10020): the self-judge is the failure mode.

## Area 2 — Skill/lesson library (beyond Voyager)

- **Voyager** — arXiv **2305.16291**. A skill is admitted only after
  execution-verification. → A *lesson* should earn its slot the same way: only if
  it produced a measured behavioral improvement.
- **A-MEM** — arXiv **2502.12110** (2025). Zettelkasten memory; insertion triggers
  consolidation of related notes. → Our dedup/consolidation answer: on admit, link
  + merge near-duplicate lessons (keep the one with the best benchmark delta).
- **Generative Agents** — arXiv **2304.03442** (2023). Periodic **reflection**
  synthesizes low-level observations into higher-level lessons; retrieval scored
  by recency × importance × relevance. → Add a reflection/decay pass so stale,
  low-impact lessons age out instead of bloating retrieval.
- Skeptical: Mem0/MemGPT-style stores are scalable plumbing, **no validation
  signal** — they make retrieval scalable, not lessons correct.

## Area 3 — Automatic curriculum (what to improve next)

- **MAGELLAN** — arXiv **2502.07709** (ICML 2025). Agent predicts its own
  **learning progress** over a semantic goal space, prioritizes max-LP goals. →
  Rank improvement targets by *expected benchmark-score gain* from our own
  validated-commit history (we already store score deltas — free labels).
- **POET / MAP-Elites quality-diversity** (2019+). → Structure the archive as **QD,
  not a single champion**: bin validated lesson-sets by behavioral descriptor,
  sample parents across bins to preserve stepping stones (the DGM finding that
  low-performing ancestors enabled later breakthroughs).
- Skeptical: pure novelty search wastes evals; use LP-weighted QD.

## Area 4 — World models for the robot (exploration only, NOT a gate)

- **V-JEPA 2 / V-JEPA 2-AC** — arXiv **2506.09985** (Meta 2025). Action-free
  latent-space video prediction; zero-shot pick-and-place via planning. → Cleanest
  fit for the modality-agnostic `ExperienceSource`: **latent prediction error =
  surprise = an experience** feeding the *proposal* stage. Latent (not pixel) space
  is robust to irrelevant visual noise.
- **DreamerV3** + **RND** (intrinsic motivation). → Same seam; surprise feeds the
  curriculum selector for the embodied agent.
- **Most important caveat:** prediction error is **exploration**, never
  **validation**. RND/ICM "noisy-TV" trap = the embodied analog of our
  keyword-gaming bug. Feed JEPA surprise to proposal + curriculum; keep the gate
  execution-grounded.

## Area 5 — Safety of recursive self-modification

- **DGM** safety posture: sandbox + human oversight + transparent git lineage
  (which is how the fabricated-log sabotage was caught). → Make our git
  reversibility a **tamper-evident audit trail**: log the grader's raw output
  alongside each commit so a fabricated pass is detectable.
- **Reward-hacking pair** (2402.06627, 2507.08794). → **Tripwire**: a frozen
  *canary* benchmark the optimizer never sees and never proposes against; run every
  N rounds; any drop ⇒ halt + roll back to last-good commit (we now have
  `restore --best`).
- Directional (unverified 2026 IDs — confirm before external citation): SAHOO
  2603.06333 (two-gate guardrails), sandbox-escape 2603.02277, AI Agent Index
  2602.17753. → Human approval for any self-mod touching the grader, sandbox, or
  tripwire; egress allowlist + resource caps on the self-mod sandbox.

## Top 5 changes, ranked by impact-to-effort

1. **Replace retrievability fitness with an execution-grounded paired gate.**
   *(Highest impact, moderate effort — fixes the core weakness.)* — DGM 2505.22954;
   CLT 2503.01747.
2. **Counterfactual-ablation pre-filter** — reject lessons that change no behavior.
   *(High impact, low effort.)* — DGM 2505.22954.
3. **Paired-Bayesian acceptance with anytime stopping** (drop CLT/mean compares).
   *(High impact, low effort.)* — 2503.01747.
4. **Deterministic-grader-only + tamper-evident lineage + frozen canary tripwire.**
   *(High impact, low-moderate effort — reuses our git layer + `restore --best`.)*
   — DGM 2505.22954; 2402.06627; 2507.08794.
5. **Archive as LP-weighted quality-diversity + A-MEM consolidation.**
   *(Medium impact, compounding.)* — MAGELLAN 2502.07709; MAP-Elites/POET; A-MEM
   2502.12110.

## How this maps to the current code

- Current gate: `src/agent/self-improvement/empirical-gate.ts` (retrieval delta).
  → #1 replaces the `score()` with an execution harness; #2 adds an ablation
  pre-filter; #3 replaces the strict `delta>0` with a paired-Bayesian accept.
- Reversibility already done: `learning-store.ts` (git versions + `restore --best`)
  — extend with raw-grader logging (#4) and a frozen canary set (#4).
- Curriculum: `capability-benchmark.ts:selectNextScenario` → #3/#5 (LP-weighted).
- Robot seam: `experience-source.ts:SensorExperienceSource` → Area 4 (V-JEPA
  surprise as experiences), exploration only.

**Verified arXiv IDs:** DGM 2505.22954, CLT 2503.01747, A-MEM 2502.12110, MAGELLAN
2502.07709, V-JEPA 2 2506.09985, STOP 2310.02304, Generative Agents 2304.03442,
ICRH 2402.06627, One Token to Fool 2507.08794, Gödel Agent 2410.04444, SWE-bench
Illusion 2506.12286, SWE-bench Pro 2509.16941.
