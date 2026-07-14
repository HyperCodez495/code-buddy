# Cognitive mesh: parallel embodied runtime

Code Buddy is moving from one long sequential assistant transaction to a set of independent, bounded cognitive lanes. This is an operational architecture, not a claim that Lisa has biological consciousness or subjective feelings.

## Runtime shape

```text
camera ─┐                         ┌─ fast dialogue / reflex ─┐
audio  ─┼─ isolated ingress ─────►│                         │
screen ─┤                         │  bounded cognitive      ├─► one arbiter ─► one voice
vitals ─┘                         │  workspace              │
                                  │                         │
Fleet / local models ────────────►│  memory / critic /      │
                                  │  planner / prospective  │
                                  └─────────────────────────┘
```

The body can see, hear, maintain memory and deliberate concurrently, but it still has one canonical outward answer. Model outputs are proposals; permission checks and deterministic effectors remain authoritative.

## Implemented foundation

- `buddy-sense` already runs sensor organs on separate bounded channels and uses salience to arbitrate ingress.
- `HeartbeatScheduler` now owns one in-flight lock per treatment. Dreaming or an LLM maintenance pass cannot stop other organs from receiving later beats.
- `GlobalWorkspace` is an in-memory blackboard with a hard capacity, TTL, immutable clones, salience admission and monotone privacy.
- `CognitiveMesh` gives each specialist a bounded mailbox, overflow policy, concurrency limit, provider-group limit, deadline signal and raw-free metrics.
- Every specialist declares a privacy clearance. Cloud lanes accept only `cloud-ok`; trusted-LAN lanes cannot receive `local-only`; local lanes may accept all three classes. Rejected deliveries are counted without logging content.
- The sensory adapter runs in shadow mode. It mirrors only modality, canonical event kind and observation time; raw audio, transcripts, image bytes and local image paths never enter the workspace.
- A separate recognized-utterance lane starts before response selection, model generation and TTS. It publishes the local-only text with one `turnId` shared by voice cognition and avatar events while the canonical mouth lock remains intact.
- The deterministic WorldModel V1 tracks anonymous occupancy per camera with `visible|absent|unknown`, `firstSeen`, `lastSeen`, confidence, causal cursor and bounded provenance. Duplicate and out-of-order transitions cannot regress current state; wall-clock expiry becomes `unknown`, never invented absence.
- Prospective event extraction can run while Lisa generates and speaks. Its eventual confirmation remains a mouth-serialized initiative.
- Telegram/Cowork journal appends retain their strict bridge ordering, but slow channel delivery no longer holds the local mouth lock for reminder, maison and proactive voice initiatives.
- Council local models and Fleet peers now start in the same wave. Local model timeouts propagate cancellation to transports that support `AbortSignal`.

## Safety and scheduling invariants

1. One body, one mouth, one visible canonical response.
2. One writer for persistent state; LLM specialists only propose changes.
3. A slow or failed specialist does not stop the others.
4. One specialist does not overlap itself unless explicitly configured as stateless.
5. Privacy can only become stricter through derivation (`cloud-ok` → `trusted-lan` → `local-only`), never weaker.
6. Camera and microphone data stay local unless an explicit, separately reviewed adapter grants egress.
7. Every queue and workspace is bounded. Overflow drops or coalesces low-value work instead of consuming unbounded memory.
8. Realtime dialogue never waits for background reflection or a full Council.
9. Using more available models is selective: routing depends on salience, task, privacy, provider capacity and budget.

## Next loops

### 1. Complete voice transaction decomposition

The recognized-utterance lane is complete. Next, move the durable outcome percept off the post-TTS path, propagate the correlation id through reminder/maison shortcuts, and add generation checks so late proposals from an obsolete turn are discarded. Preserve barge-in and the single-mouth invariant.

### 2. World model enrichment

Add anonymous tracker ids, 2D observations and explicit camera liveness refreshes. A deterministic reducer continues to own facts; VLM/LLM hypotheses cannot directly rewrite them. Do not infer metric 3D geometry without calibrated sensors.

### 3. Persistent specialist adapters

Give dialogue, critic, research, planner, memory and prospective specialists isolated local clients or Fleet sessions. Add atomic budget reservation before admission and capacity groups for models sharing one GPU.

### 4. Selective workspace context

Inject only the highest-value, privacy-compatible workspace items into each specialist under a token budget. Measure whether this improves grounded conversation before enabling it on the realtime voice path.

### 5. Cowork observability

Expose queue depth, dropped/coalesced work, deadlines, p50/p95 latency and provider occupancy without payload content. Add controls to pause a lane, inspect its safe outputs and replay a correlation ID.

### 6. Physics and prospective simulation

Add object permanence, relations and action predictions only after the observation model is reliable. Treat simulations as confidence-labelled hypotheses, never as observed facts.
