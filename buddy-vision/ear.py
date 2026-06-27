#!/usr/bin/env python3
"""
Robot ear — live microphone → voice-activity-detection → `speech_end` events
to the Code Buddy sensory bridge (ws://127.0.0.1:8129).

This is the missing "ears" of the companion: the camera eye (watch.py) notices a
person, but until now nothing captured live speech. This daemon captures the mic
via `arecord` (ALSA — no PortAudio/sudo needed), runs an energy VAD with
hysteresis, and on each utterance writes a 16 kHz mono WAV and emits

    {"modality":"audio","kind":"speech_end","ts_ms":...,"salience":200,
     "payload":{"wav":"/abs/path.wav","rms":0.12,"ms":1840}}

The brain (buddy server, CODEBUDDY_SENSORY_SPEECH=true) transcribes that WAV with
faster-whisper and runs the response loop. Best-effort, never-crashes, reconnects.

Env (shared via ~/.codebuddy/vision.env, same as the eye):
  BUDDY_SENSE_BRIDGE_URL   default ws://127.0.0.1:8129
  BUDDY_SENSE_TOKEN        bridge auth token (same as the eye)
  BUDDY_EAR_DEVICE         ALSA capture device (default: plughw:CARD=BRIO,DEV=0)
  BUDDY_EAR_RMS_ON / _OFF  VAD thresholds 0..1 (default 0.020 / 0.012, hysteresis)
  BUDDY_EAR_MIN_MS         ignore blips shorter than this (default 350)
  BUDDY_EAR_MAX_MS         cap an utterance (default 15000)
  BUDDY_EAR_HANG_MS        trailing silence that ends an utterance (default 700)
  BUDDY_EAR_WAV_DIR        where utterance WAVs are written (default ~/.codebuddy/companion)
"""
import json
import os
import subprocess
import sys
import time
import wave

import numpy as np
import websocket

RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = RATE * FRAME_MS // 1000          # 320 samples
FRAME_BYTES = FRAME_SAMPLES * 2                   # 16-bit mono

BRIDGE_URL = os.environ.get("BUDDY_SENSE_BRIDGE_URL", "ws://127.0.0.1:8129")
TOKEN = os.environ.get("BUDDY_SENSE_TOKEN", "")
DEVICE = os.environ.get("BUDDY_EAR_DEVICE", "plughw:CARD=BRIO,DEV=0")
RMS_ON = float(os.environ.get("BUDDY_EAR_RMS_ON", "0.020"))
RMS_OFF = float(os.environ.get("BUDDY_EAR_RMS_OFF", "0.012"))
MIN_MS = int(os.environ.get("BUDDY_EAR_MIN_MS", "350"))
MAX_MS = int(os.environ.get("BUDDY_EAR_MAX_MS", "15000"))
HANG_MS = int(os.environ.get("BUDDY_EAR_HANG_MS", "700"))
WAV_DIR = os.path.expanduser(os.environ.get("BUDDY_EAR_WAV_DIR", "~/.codebuddy/companion"))
PREROLL_FRAMES = 8  # ~160 ms kept before speech onset so the first word isn't clipped


def now_ms() -> int:
    return int(time.time() * 1000)


def log(msg: str) -> None:
    print(f"[ear] {msg}", file=sys.stderr, flush=True)


class Bridge:
    """Reconnecting WebSocket client to the sensory bridge (mirrors watch.py)."""

    def __init__(self, url: str, token: str):
        self.url, self.token, self.ws = url, token, None

    def connect(self) -> None:
        try:
            # suppress_origin: the bridge rejects connections carrying an Origin header.
            self.ws = websocket.create_connection(self.url, timeout=5, suppress_origin=True)
            log(f"bridge connected → {self.url}")
        except Exception as exc:
            self.ws = None
            log(f"bridge connect failed: {exc}")

    def emit(self, kind: str, salience: int, payload: dict) -> None:
        frame = {"modality": "audio", "kind": kind, "ts_ms": now_ms(), "salience": salience, "payload": payload}
        if self.token:
            frame["token"] = self.token
        msg = json.dumps(frame)
        for _ in range(2):
            if self.ws is None:
                self.connect()
            if self.ws is None:
                return
            try:
                self.ws.send(msg)
                return
            except Exception:
                self.ws = None


def rms_norm(frame_i16: np.ndarray) -> float:
    """Normalised RMS in 0..1 (mirrors buddy-sense audio.rs energy VAD)."""
    if frame_i16.size == 0:
        return 0.0
    return float(np.sqrt(np.mean((frame_i16.astype(np.float32) / 32768.0) ** 2)))


def write_wav(path: str, frames: list) -> None:
    pcm = np.concatenate(frames) if frames else np.zeros(0, dtype=np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def open_arecord() -> subprocess.Popen:
    cmd = ["arecord", "-D", DEVICE, "-f", "S16_LE", "-r", str(RATE), "-c", "1", "-t", "raw", "-q", "-"]
    log(f"starting capture: {' '.join(cmd)}")
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=FRAME_BYTES)


def read_frame(proc: subprocess.Popen) -> bytes | None:
    buf = b""
    while len(buf) < FRAME_BYTES:
        chunk = proc.stdout.read(FRAME_BYTES - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def main() -> None:
    os.makedirs(WAV_DIR, exist_ok=True)
    bridge = Bridge(BRIDGE_URL, TOKEN)
    bridge.connect()
    log(f"listening on {DEVICE} (RMS on/off {RMS_ON}/{RMS_OFF}, min {MIN_MS}ms, hang {HANG_MS}ms)")

    hang_frames = max(1, HANG_MS // FRAME_MS)
    max_frames = MAX_MS // FRAME_MS
    min_frames = MIN_MS // FRAME_MS

    proc = open_arecord()
    preroll: list = []
    speaking = False
    voiced: list = []
    silence_run = 0
    peak_rms = 0.0

    while True:
        raw = read_frame(proc)
        if raw is None:
            log("capture stream ended — restarting arecord in 1s")
            try:
                proc.kill()
            except Exception:
                pass
            time.sleep(1)
            proc = open_arecord()
            speaking, voiced, silence_run, peak_rms = False, [], 0, 0.0
            continue

        frame = np.frombuffer(raw, dtype=np.int16)
        level = rms_norm(frame)

        if not speaking:
            preroll.append(frame)
            if len(preroll) > PREROLL_FRAMES:
                preroll.pop(0)
            if level >= RMS_ON:
                speaking = True
                voiced = list(preroll)  # include pre-roll so the first word survives
                preroll = []
                silence_run = 0
                peak_rms = level
                bridge.emit("speech_start", 150, {"rms": round(level, 4)})
        else:
            voiced.append(frame)
            peak_rms = max(peak_rms, level)
            if level < RMS_OFF:
                silence_run += 1
            else:
                silence_run = 0

            ended = silence_run >= hang_frames
            too_long = len(voiced) >= max_frames
            if ended or too_long:
                speech_frames = len(voiced) - silence_run
                if speech_frames >= min_frames:
                    ms = len(voiced) * FRAME_MS
                    path = os.path.join(WAV_DIR, f"utt-{now_ms()}.wav")
                    try:
                        write_wav(path, voiced)
                        bridge.emit("speech_end", 200, {"wav": path, "rms": round(peak_rms, 4), "ms": ms})
                        log(f"utterance {ms}ms peak_rms={peak_rms:.3f} → {path}")
                    except Exception as exc:
                        log(f"utterance write/emit failed: {exc}")
                speaking, voiced, silence_run, peak_rms = False, [], 0, 0.0


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # never die silently without a reason in the journal
        log(f"fatal: {exc}")
        time.sleep(2)
        sys.exit(1)
