# buddy-sense

A parallel, event-driven **nervous system** in Rust — the perception layer for
[Code Buddy](https://github.com/phuetz/code-buddy) / the Lisa companion.

The human brain is massively parallel: vision, hearing, breathing, heartbeat all
run concurrently, ordered by the brain, and memory updates in parallel. `buddy-sense`
reproduces that principle: each **sense** runs concurrently, a **thalamus** orders
and prioritizes the stream, and a **bridge** feeds events into Code Buddy's event
bus, where they trigger processing.

```
 senses (parallel) ──▶ thalamus ──────────▶ bridge ──▶ Code Buddy
  audio  (cpal/WAV)    coalesce · prioritize  (WebSocket)  event bus
  video  (planned)     salience escalation               → reactions
  vital  (heartbeat)   short-term ring memory              (STT, vision…)
        │                     │
   bounded mpsc          broadcast
   (backpressure)      (global workspace)
```

- **Senses** emit `SensoryEvent { modality, kind, ts_ms, salience, payload }`.
- **Thalamus** (`bus.rs`): coalesces high-rate low-salience bursts, escalates
  salient events (wake-word / speech / motion), keeps a per-modality ring buffer
  (parallel short-term memory), and broadcasts (the "global workspace", GWT).
- **Audio** (`senses/audio.rs`): energy-based VAD → `speech_start`/`speech_end`.
  Heavy work (STT, vision models) is **delegated to Code Buddy** — this stays light.
- **Bridge** (`bridge.rs`): ships events as JSON over a WebSocket to Code Buddy's
  `sensory-bridge`, which re-emits them onto its internal event bus.

## Build & run

    cargo test                       # thalamus + VAD + serialization (no hardware)
    cargo build
    BUDDY_SENSE_BRIDGE_URL=ws://127.0.0.1:8129 \
      ./target/debug/buddy-sense path/to/audio.wav    # run the audio sense over a WAV
    ./target/debug/buddy-sense       # demo: a heartbeat every 2s

On the Code Buddy side: `CODEBUDDY_SENSORY=true buddy server` starts the bridge.

Live microphone is opt-in (`--features live-mic`, needs `libasound2-dev`); the
WAV path needs no system audio deps. Built with tokio + cpal + nokhwa (planned) +
tokio-tungstenite. Local-only.
