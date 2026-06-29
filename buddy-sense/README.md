# buddy-sense

A parallel, event-driven **nervous system** in Rust — the perception layer for
[Code Buddy](https://github.com/phuetz/code-buddy) / the Lisa companion.

The human brain is massively parallel: sight, hearing, and the heartbeat all run
concurrently, gated by the brain, and memory consolidates in the background.
`buddy-sense` reproduces that: the **sense modules** run concurrently, a **thalamus**
gates/coalesces the stream, and a **bridge** feeds events into Code Buddy's event
bus, where they trigger processing (and heartbeat-paced memory consolidation). The
default daemon emits the heartbeat (and audio when given a WAV); the screen/ui live
captures are opt-in features, and vision is a detector core with no live path yet.

![architecture](docs/architecture.svg)

- **Senses** emit `SensoryEvent { modality, kind, ts_ms, salience, payload }` over
  bounded channels (backpressure).
- **Thalamus** (`bus.rs`): coalesces high-rate low-salience bursts, lets salient
  events bypass coalescing (an attention **gate** — note: it does not reorder by
  priority), and broadcasts (the "global workspace", GWT). The vital heartbeat is
  never coalesced. (A per-modality ring buffer is Phase-2/3 scaffolding, not yet
  read by the binary; the real short-term memory is on the Code Buddy side.)
- **Bridge** (`bridge.rs`): ships events as JSON over a WebSocket (loopback,
  Origin-checked, optional token) to Code Buddy's `sensory-bridge`.
- Heavy analysis (STT, vision models, OCR) is **delegated to Code Buddy** — the
  daemon stays light.

## The five senses

| Sense | File | Emits | Live capture |
|-------|------|-------|--------------|
| **audio** | `senses/audio.rs` | `speech_start/end` (energy VAD, or Silero neural) | WAV file (no live mic yet) |
| **vital** | `senses/vital.rs` | `heartbeat` (uptime, load) — the autonomic rhythm | always on |
| **vision** | `senses/video.rs` | `motion` (→ Code Buddy `camera_analyze`) | detector core (frames fed) |
| **screen** | `senses/screen.rs` | `change` (xcap screen diff) | `live-screen` (xcap) |
| **ui** | `senses/ui.rs` | `app_focus`/`window_title`/`element_focus` (AT-SPI) | `live-ui` (atspi) |

## Heartbeat-paced memory ("dreaming")

The heartbeat is a pacemaker: every N beats, Code Buddy's `dreaming` consolidates
the short-term sensory buffer into long-term memory (salient dreams →
`CODEBUDDY_MEMORY.md`, the file the agent reads). The heartbeat-paced analogue of
OpenClaw's dreaming.

![dreaming](docs/dreaming.svg)

## Build & run

```bash
cargo test                                   # pure cores: thalamus, VAD, motion, mapper (no hardware)
cargo build
BUDDY_SENSE_BRIDGE_URL=ws://127.0.0.1:8129 \
  ./target/debug/buddy-sense path/to/audio.wav   # audio sense over a WAV (+ the heartbeat)
./target/debug/buddy-sense                   # heartbeat-only (pass a .wav for audio)
```

Or run the headless end-to-end demo (heartbeat + audio VAD over a generated WAV →
Code Buddy's event bus, no hardware):

```bash
./demo.sh
```

On the Code Buddy side: `CODEBUDDY_SENSORY=true buddy server` starts the bridge.

### Optional features (opt-in; the core builds + tests without them)

| Feature | Adds | System / model needs |
|---------|------|----------------------|
| `live-screen` | live screen capture (xcap, X11/Wayland) | xcb libs |
| `live-ui` | live AT-SPI focus events (atspi/zbus) | a running a11y bus (none to build) |
| `neural-vad` | Silero neural VAD via ONNX Runtime | a model + onnxruntime — see [models/README.md](models/README.md) |
| `stt` | in-process offline STT (sherpa-onnx) — the `buddy-sense stt` subcommand | nothing to install: sherpa-rs's `download-binaries` fetches the prebuilt sherpa-onnx + onnxruntime at build (no C++ compile, no sudo) |

#### In-process STT (`stt` feature)

`buddy-sense stt` is a persistent worker: it loads the NeMo Parakeet-TDT offline
transducer **once** and decodes a whole utterance in ~110 ms (RTF ~0.03 on CPU),
replacing the out-of-process python whisper/parakeet workers — no python on the hot
path, no per-utterance spawn. Protocol (mirrors the TS `FasterWhisperWorker`): emits
`{"ready":true}` once loaded, then reads `{"id","wav"}` lines on stdin and answers
`{"id","text"}` (or `{"id","error"}`) on stdout; sherpa's own logs go to stderr.

```bash
cargo build --release --features stt
# the prebuilt .so are copied next to the binary → point the loader at that dir:
LD_LIBRARY_PATH=target/release \
  BUDDY_SENSE_STT_MODEL_DIR=~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 \
  ./target/release/buddy-sense stt
```

Code Buddy's `speech-reaction.ts` drives this worker when `CODEBUDDY_SPEECH_ENGINE=sherpa-rs`
(or `auto` when the binary is built). Env: `BUDDY_SENSE_STT_MODEL_DIR` (model dir),
`BUDDY_SENSE_STT_THREADS` (decode threads). **Rebuild after pulling** — an older
binary built without `stt` ignores the `stt` arg and runs the daemon instead.

Built with tokio + tokio-tungstenite (+ optional cpal / xcap / atspi / vad-rs).
Local-only, $0. Permissive deps (MIT/Apache) — clean-room, no proprietary code.
