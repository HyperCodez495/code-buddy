#!/usr/bin/env python3
"""
Robot ear — live microphone → voice-activity-detection → `speech_end` events
to the Code Buddy sensory bridge (ws://127.0.0.1:8129).

This is the missing "ears" of the companion: the camera eye (watch.py) notices a
person, but until now nothing captured live speech. This daemon captures the mic
via `arecord` (ALSA — no PortAudio/sudo needed), runs an energy VAD with
hysteresis, and on each utterance writes a 16 kHz mono WAV and emits

    {"modality":"audio","kind":"speech_end","ts_ms":...,"salience":200,
     "payload":{"wav":"/abs/path.wav","peakRms":0.12,"avgRms":0.04,"ms":1840}}

The brain (buddy server, CODEBUDDY_SENSORY_SPEECH=true) transcribes that WAV with
faster-whisper and runs the response loop. Best-effort, never-crashes, reconnects.

Env (shared via ~/.codebuddy/vision.env, same as the eye):
  BUDDY_SENSE_BRIDGE_URL   default ws://127.0.0.1:8129
  BUDDY_SENSE_TOKEN        bridge auth token (same as the eye)
  BUDDY_EAR_DEVICE         ALSA capture device, or "auto" to prefer webcam mics
                           (default: auto)
  BUDDY_EAR_RMS_ON / _OFF  VAD thresholds 0..1 (default 0.020 / 0.012, hysteresis)
  BUDDY_EAR_MIN_MS         ignore blips shorter than this (default 350)
  BUDDY_EAR_MAX_MS         cap an utterance (default 15000)
  BUDDY_EAR_HANG_MS        trailing silence that ends an utterance (default 700)
  BUDDY_EAR_WAV_DIR        where utterance WAVs are written (default ~/.codebuddy/companion)
"""
import json
import os
import argparse
import subprocess
import sys
import time
import wave

RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = RATE * FRAME_MS // 1000          # 320 samples
FRAME_BYTES = FRAME_SAMPLES * 2                   # 16-bit mono

BRIDGE_URL = os.environ.get("BUDDY_SENSE_BRIDGE_URL", "ws://127.0.0.1:8129")
TOKEN = os.environ.get("BUDDY_SENSE_TOKEN", "")
DEVICE_ENV = os.environ.get("BUDDY_EAR_DEVICE", "auto").strip() or "auto"
CURRENT_DEVICE = DEVICE_ENV
RMS_ON = float(os.environ.get("BUDDY_EAR_RMS_ON", "0.020"))
RMS_OFF = float(os.environ.get("BUDDY_EAR_RMS_OFF", "0.012"))
MIN_MS = int(os.environ.get("BUDDY_EAR_MIN_MS", "350"))
MAX_MS = int(os.environ.get("BUDDY_EAR_MAX_MS", "15000"))
HANG_MS = int(os.environ.get("BUDDY_EAR_HANG_MS", "700"))
WAV_DIR = os.path.expanduser(os.environ.get("BUDDY_EAR_WAV_DIR", "~/.codebuddy/companion"))
PREROLL_FRAMES = 8  # ~160 ms kept before speech onset so the first word isn't clipped
np = None

PREFERRED_MIC_KEYWORDS = (
    "brio",
    "webcam",
    "camera",
    "c920",
    "c922",
    "logitech",
    "usb video",
    "hd pro webcam",
    "integrated camera",
)
BAD_MIC_KEYWORDS = ("monitor", "hdmi", "displayport")


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
            import websocket
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


def rms_norm(frame_i16) -> float:
    """Normalised RMS in 0..1 (mirrors buddy-sense audio.rs energy VAD)."""
    if np is None:
        raise RuntimeError("numpy runtime not initialized")
    if frame_i16.size == 0:
        return 0.0
    return float(np.sqrt(np.mean((frame_i16.astype(np.float32) / 32768.0) ** 2)))


def write_wav(path: str, frames: list) -> None:
    if np is None:
        raise RuntimeError("numpy runtime not initialized")
    pcm = np.concatenate(frames) if frames else np.zeros(0, dtype=np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def parse_arecord_devices(output: str) -> list[dict]:
    devices = []
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("card "):
            continue
        try:
            # Example:
            # card 2: BRIO [Logitech BRIO], device 0: USB Audio [USB Audio]
            before_device, after_device = line.split(", device ", 1)
            card_part = before_device.removeprefix("card ").strip()
            card_index, card_rest = card_part.split(":", 1)
            card_id = card_rest.strip().split(" ", 1)[0]
            card_name = card_rest[card_rest.find("[") + 1:card_rest.find("]")] if "[" in card_rest and "]" in card_rest else card_id
            device_index, device_rest = after_device.split(":", 1)
            device_name = device_rest[device_rest.find("[") + 1:device_rest.find("]")] if "[" in device_rest and "]" in device_rest else device_rest.strip()
            devices.append({
                "card_index": card_index.strip(),
                "card_id": card_id.strip(),
                "card_name": card_name.strip(),
                "device_index": device_index.strip(),
                "device_name": device_name.strip(),
                "line": line,
            })
        except Exception:
            continue
    return devices


def mic_score(device: dict) -> int:
    text = f"{device.get('card_id', '')} {device.get('card_name', '')} {device.get('device_name', '')}".lower()
    score = 0
    if any(keyword in text for keyword in PREFERRED_MIC_KEYWORDS):
        score += 100
    if "usb" in text:
        score += 20
    if any(keyword in text for keyword in BAD_MIC_KEYWORDS):
        score -= 100
    return score


def alsa_device_name(device: dict) -> str:
    card = device.get("card_id") or device.get("card_index") or "0"
    dev = device.get("device_index") or "0"
    return f"plughw:CARD={card},DEV={dev}"


def list_capture_devices() -> tuple[list[dict], str | None]:
    try:
        output = subprocess.check_output(["arecord", "-l"], text=True, stderr=subprocess.STDOUT, timeout=3)
    except Exception as exc:
        return [], str(exc)
    return parse_arecord_devices(output), None


def select_capture_device(devices: list[dict]) -> dict | None:
    if not devices:
        return None
    return max(devices, key=mic_score)


def detect_capture_device() -> str:
    if DEVICE_ENV.lower() != "auto":
        return DEVICE_ENV
    devices, error = list_capture_devices()
    if error:
        log(f"cannot list ALSA capture devices, falling back to default: {error}")
        return "default"
    if not devices:
        log("no ALSA capture devices found, falling back to default")
        return "default"
    selected = select_capture_device(devices)
    if not selected:
        return "default"
    selected_name = alsa_device_name(selected)
    log(f"auto-selected microphone: {selected_name} ({selected.get('card_name')} / {selected.get('device_name')})")
    return selected_name


def build_diagnostics() -> dict:
    devices, error = list_capture_devices()
    selected = select_capture_device(devices) if DEVICE_ENV.lower() == "auto" else None
    selected_name = DEVICE_ENV if DEVICE_ENV.lower() != "auto" else (alsa_device_name(selected) if selected else "default")
    return {
        "ok": error is None,
        "error": error,
        "requestedDevice": DEVICE_ENV,
        "selectedDevice": selected_name,
        "selectedReason": "explicit" if DEVICE_ENV.lower() != "auto" else "auto-prefer-webcam-usb",
        "rate": RATE,
        "frameMs": FRAME_MS,
        "vad": {
            "rmsOn": RMS_ON,
            "rmsOff": RMS_OFF,
            "minMs": MIN_MS,
            "maxMs": MAX_MS,
            "hangMs": HANG_MS,
        },
        "devices": [
            {
                **device,
                "alsa": alsa_device_name(device),
                "score": mic_score(device),
                "selected": alsa_device_name(device) == selected_name,
            }
            for device in devices
        ],
    }


def print_diagnostics(as_json: bool) -> None:
    diagnostics = build_diagnostics()
    if as_json:
        print(json.dumps(diagnostics, indent=2))
        return
    print("Buddy ear diagnostics")
    print("=====================")
    print(f"requested: {diagnostics['requestedDevice']}")
    print(f"selected: {diagnostics['selectedDevice']} ({diagnostics['selectedReason']})")
    print(f"vad: on={RMS_ON} off={RMS_OFF} min={MIN_MS}ms hang={HANG_MS}ms")
    if diagnostics["error"]:
        print(f"arecord: {diagnostics['error']}")
    if not diagnostics["devices"]:
        print("devices: none")
        return
    print("devices:")
    for device in diagnostics["devices"]:
        marker = "*" if device["selected"] else "-"
        print(f"{marker} {device['alsa']} score={device['score']} {device['card_name']} / {device['device_name']}")


def ensure_runtime_imports() -> None:
    global np
    import numpy as numpy
    np = numpy


def open_arecord() -> subprocess.Popen:
    global CURRENT_DEVICE
    device = detect_capture_device()
    CURRENT_DEVICE = device
    cmd = ["arecord", "-D", device, "-f", "S16_LE", "-r", str(RATE), "-c", "1", "-t", "raw", "-q", "-"]
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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Code Buddy live microphone sidecar")
    parser.add_argument("--diagnose", action="store_true", help="print ALSA microphone diagnostics and exit")
    parser.add_argument("--list-devices", action="store_true", help="alias for --diagnose")
    parser.add_argument("--json", action="store_true", help="print diagnostics as JSON")
    args = parser.parse_args(argv)
    if args.diagnose or args.list_devices:
        print_diagnostics(args.json)
        return

    ensure_runtime_imports()
    os.makedirs(WAV_DIR, exist_ok=True)
    bridge = Bridge(BRIDGE_URL, TOKEN)
    bridge.connect()
    log(f"listening on {DEVICE_ENV} (RMS on/off {RMS_ON}/{RMS_OFF}, min {MIN_MS}ms, hang {HANG_MS}ms)")

    hang_frames = max(1, HANG_MS // FRAME_MS)
    max_frames = MAX_MS // FRAME_MS
    min_frames = MIN_MS // FRAME_MS

    proc = open_arecord()
    preroll: list = []
    speaking = False
    voiced: list = []
    silence_run = 0
    peak_rms = 0.0
    rms_samples: list = []
    utterance_started_at = 0

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
            speaking, voiced, silence_run, peak_rms, rms_samples, utterance_started_at = False, [], 0, 0.0, [], 0
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
                rms_samples = [level]
                utterance_started_at = now_ms()
                bridge.emit("speech_start", 150, {
                    "rms": round(level, 4),
                    "device": CURRENT_DEVICE,
                    "sampleRate": RATE,
                    "frameMs": FRAME_MS,
                    "rmsOn": RMS_ON,
                    "rmsOff": RMS_OFF,
                })
        else:
            voiced.append(frame)
            peak_rms = max(peak_rms, level)
            rms_samples.append(level)
            if level < RMS_OFF:
                silence_run += 1
            else:
                silence_run = 0

            ended = silence_run >= hang_frames
            too_long = len(voiced) >= max_frames
            if ended or too_long:
                ended_reason = "max_ms" if too_long else "silence"
                speech_frames = len(voiced) - silence_run
                if speech_frames >= min_frames:
                    ms = len(voiced) * FRAME_MS
                    path = os.path.join(WAV_DIR, f"utt-{now_ms()}.wav")
                    try:
                        ended_at = now_ms()
                        avg_rms = sum(rms_samples) / len(rms_samples) if rms_samples else peak_rms
                        write_started_at = now_ms()
                        write_wav(path, voiced)
                        write_ms = now_ms() - write_started_at
                        bridge.emit("speech_end", 200, {
                            "wav": path,
                            "rms": round(peak_rms, 4),
                            "peakRms": round(peak_rms, 4),
                            "avgRms": round(avg_rms, 4),
                            "ms": ms,
                            "device": CURRENT_DEVICE,
                            "startedAtMs": utterance_started_at,
                            "endedAtMs": ended_at,
                            "writeMs": write_ms,
                            "sampleRate": RATE,
                            "frameMs": FRAME_MS,
                            "vadHangMs": HANG_MS,
                            "endedReason": ended_reason,
                            "rmsOn": RMS_ON,
                            "rmsOff": RMS_OFF,
                        })
                        log(f"utterance {ms}ms reason={ended_reason} peak_rms={peak_rms:.3f} avg_rms={avg_rms:.3f} → {path}")
                    except Exception as exc:
                        log(f"utterance write/emit failed: {exc}")
                speaking, voiced, silence_run, peak_rms, rms_samples, utterance_started_at = False, [], 0, 0.0, [], 0


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # never die silently without a reason in the journal
        log(f"fatal: {exc}")
        time.sleep(2)
        sys.exit(1)
