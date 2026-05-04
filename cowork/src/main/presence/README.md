# Presence — face memory for Cowork

Recognises who is in front of the camera and surfaces the result to the
Code Buddy core agent so its system prompt can be personalised. The
agent then chooses an appropriate greeting register (formal / nickname /
neutral) based on conversational history — we don't hardcode the
greeting itself.

## Quick architecture

```
[webcam stream]                     ← navigator.mediaDevices.getUserMedia (renderer)
       ↓
[FaceDetector]                      ← MediaPipe BlazeFace, renderer/services/presence/
       ↓ crop 112×112 RGB
       ↓ via IPC presence:encode
[FaceRecognizer]                    ← InsightFace Buffalo_S ArcFace ONNX, main/presence/
       ↓ 512-dim embedding
       ↓ via IPC presence:match
[PresenceStore]                     ← JSON @ <userData>/presence-store.json
       ↓ cosine top-1
[PresenceBridge]                    ← event bus + writes <home>/.codebuddy/presence/current.json
       ↓ cross-process file
[presence-injector]                 ← src/memory/presence-injector.ts
       ↓ formats <presence> block
[memory-lifecycle-hooks::beforeExecute]
       ↓ injects into system prompt
[LLM]                               ← chooses greeting register
```

## Components

| File | Process | Role |
|---|---|---|
| `cowork/src/shared/presence/types.ts` | both | Shared types (PersonIdentity, FaceDetection, PresenceEvent) |
| `cowork/src/renderer/services/presence/face-detector.ts` | renderer | MediaPipe BlazeFace face detection (where + bounding box) |
| `cowork/src/main/presence/face-recognizer.ts` | main | ArcFace Buffalo_S ONNX inference (who) |
| `cowork/src/main/presence/presence-store.ts` | main | Persistent JSON identity store, cosine match |
| `cowork/src/main/presence/presence-bridge.ts` | main | IPC handlers + event bus + cross-process state file |
| `cowork/src/renderer/components/EnrollmentDialog.tsx` | renderer | UI: capture 5 face samples → enroll |
| `cowork/src/renderer/components/PresenceIndicator.tsx` | renderer | Status badge in header |
| `src/memory/presence-injector.ts` | core agent | Reads cross-process file, formats `<presence>` block |

## Setup

### 1. Install runtime dependencies

```bash
cd cowork
npm install
```

This pulls `@mediapipe/tasks-vision` (~ 1 MB on top of normal install)
and `onnxruntime-node` (native binding ~30 MB).

### 2. Download the Buffalo_S face recognition model

Buffalo_S is the small variant of InsightFace's ArcFace family. ~13 MB,
512-dim embedding output, 112×112 RGB input.

**Manual install (V0)**:

1. Download `buffalo_s.zip` from
   https://github.com/deepinsight/insightface/tree/master/python-package
   (look for the `buffalo_s` model bundle in the model zoo).
2. Extract `buffalo_s/w600k_mbf.onnx` (or whichever is the recognition
   model — Buffalo_S also ships a detector model we don't need).
3. Rename it to `buffalo_s.onnx`.
4. Place it at `<userData>/models/buffalo_s.onnx`:
   - **Windows**: `%APPDATA%\codebuddy-cowork\models\buffalo_s.onnx`
   - **macOS**: `~/Library/Application Support/codebuddy-cowork/models/buffalo_s.onnx`
   - **Linux**: `~/.config/codebuddy-cowork/models/buffalo_s.onnx`

The exact path is logged on first failed call (`FaceRecognizer: Buffalo_S
model not found at <path>...`).

**V0.2 plan**: auto-download the model on first enrollment (after
explicit user consent — no silent network calls).

### 3. Enroll your face

Open the EnrollmentDialog (mounted by the renderer once `App.tsx`
wiring is done), enter your name + optional aliases (e.g.
`Patrice` + `mon chéri, patron`), face the camera, click **Capturer**
five times. The store ends up with one identity averaged from the
5 samples.

## How the greeting register works

The LLM gets a `<presence>` block in its system prompt:

```xml
<presence>
  Patrice est devant la caméra (confidence 91%).
  alias possibles: mon chéri, patron
  vu il y a 12s.
  Tu peux personnaliser ton ton et ton greeting en conséquence — choisis
  le registre que la conversation suggère, sans surjouer.
</presence>
```

We *don't* tell the LLM "say 'bonjour mon chéri'". We give it the menu
(name + alias list) and trust the model to pick the register from the
conversation history (formal session → "Bonjour Patrice", late-night
philosophical chat → "bonjour mon chéri"). This is the only place where
trusting the LLM beats hardcoding.

## V0 limitations

- **No continuous loop**: today the renderer doesn't run a background
  presence detector. Enrollment + manual checks only. V0.5 will add a
  `PresenceService` daemon that captures + matches every N seconds.
- **No auto model download**: see the section above. V0.2 plan.
- **No voice fingerprinting**: the speaker-verification side
  (`SpeakerVerifier` analogue of `FaceRecognizer`) lives on the V1
  roadmap. Audio capture infra reuses the renderer/services/presence/
  pattern.
- **Singleton store**: V0 supports multiple identities (you + your
  partner + …) but matches only the closest. Multi-person scenes (two
  faces in frame at once) just match the largest face.

## Threshold tuning

`PresenceConfig.matchThreshold` defaults to 0.5 (ArcFace cosine).
Lower = more permissive (more false positives). Higher = stricter (more
"unknown" events). With Buffalo_S + frontal indoor lighting and 5
samples per identity, 0.5 typically gives < 1% false positive on
unknown faces and > 95% recall on the enrolled ones.

If you have to share Cowork between several people who look alike (or
identical twins), tighten to 0.6+ and re-enroll with more samples.
