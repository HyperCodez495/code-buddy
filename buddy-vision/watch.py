#!/usr/bin/env python3
"""Robot eyes — semantic vision sidecar (the eye that UNDERSTANDS, not just moves).

Owns one camera and feeds bounded semantic state machines:
  • person : person present/lost → person_entered / person_lost (absence grace)
             backend: MediaPipe face detector, or optional YOLOv8 person detector
  • drowsy : MediaPipe eyeBlink blendshape closed ≥ N s → drowsy (Vigil)
A cheap motion gate (frame-diff) skips inference when nothing moves and emits a
rate-limited keyframe so the brain's local VLM can refresh its scene description.

Events go to Code Buddy's sensory bridge (ws://127.0.0.1:8129) as SensoryEvents
AND to ~/.codebuddy/companion/events.jsonl (audit/stats). 100% local, $0.
"""
import json
import os
import secrets
import sys
import time

import cv2
import numpy as np

BRIDGE_URL = os.environ.get("BUDDY_SENSE_BRIDGE_URL", "ws://127.0.0.1:8129")
TOKEN = os.environ.get("BUDDY_SENSE_TOKEN", "")
CAMERA_INDEX = int(os.environ.get("BUDDY_SENSE_CAMERA_INDEX", "0"))
CAMERA_NAME = os.environ.get("BUDDY_VISION_CAMERA_NAME", "brio")
FRAME_DIR = os.path.expanduser(os.environ.get("BUDDY_SENSE_FRAME_DIR", "~/.codebuddy/companion"))
EVENTS_LOG = os.path.join(FRAME_DIR, "events.jsonl")
EVENTS_LOG_MAX_BYTES = min(
    50 * 1024 * 1024,
    max(1 * 1024 * 1024, int(os.environ.get("BUDDY_VISION_EVENTS_LOG_MAX_BYTES", str(5 * 1024 * 1024)))),
)
MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_landmarker.task")
FPS = float(os.environ.get("BUDDY_VISION_FPS", "4"))
MOTION_THRESH = float(os.environ.get("BUDDY_VISION_MOTION", "0.02"))
PERSON_BACKEND = os.environ.get("BUDDY_VISION_PERSON_BACKEND", "mediapipe").strip().lower()
YOLO_MODEL = os.environ.get("BUDDY_VISION_YOLO_MODEL", "").strip()
YOLO_CONF = float(os.environ.get("BUDDY_VISION_YOLO_CONF", "0.35"))
YOLO_IOU = float(os.environ.get("BUDDY_VISION_YOLO_IOU", "0.7"))
YOLO_DEVICE = os.environ.get("BUDDY_VISION_YOLO_DEVICE", "").strip()
YOLO_CLASSES = os.environ.get("BUDDY_VISION_YOLO_CLASSES", "0")
EPISODE_SESSION = secrets.token_hex(4)
MOTION_FRAME_SLOTS = min(128, max(16, int(os.environ.get("BUDDY_VISION_MOTION_FRAME_SLOTS", "32"))))
SEMANTIC_FRAME_SLOTS = min(256, max(64, int(os.environ.get("BUDDY_VISION_SEMANTIC_FRAME_SLOTS", "64"))))
motion_frame_sequence = 0
semantic_frame_sequence = 0
os.makedirs(FRAME_DIR, exist_ok=True)


def now_ms() -> int:
    return int(time.time() * 1000)


class Bridge:
    """Reconnecting WebSocket client to the Code Buddy sensory bridge."""

    def __init__(self, url: str, token: str):
        self.url, self.token, self.ws = url, token, None
        self.websocket_missing = False

    def connect(self) -> None:
        if self.websocket_missing:
            return
        try:
            import websocket  # websocket-client
            # suppress_origin: the bridge rejects connections carrying an Origin
            # header (anti-CSWSH) — we must not send one.
            self.ws = websocket.create_connection(self.url, timeout=5, suppress_origin=True)
            print(f"[vision] bridge connected → {self.url}", flush=True)
        except ModuleNotFoundError:
            self.websocket_missing = True
            self.ws = None
            print("[vision] missing websocket-client — install it to emit events to Code Buddy", file=sys.stderr)
        except Exception:
            self.ws = None

    def emit(self, kind: str, salience: int, payload: dict) -> None:
        frame = {"modality": "vision", "kind": kind, "ts_ms": now_ms(), "salience": salience, "payload": payload}
        if self.token:
            frame["token"] = self.token
        msg = json.dumps(frame)
        for _ in range(2):
            if self.ws is None:
                self.connect()
            try:
                self.ws.send(msg)
                return
            except Exception:
                self.ws = None


def log_event(rec: dict) -> None:
    try:
        if os.path.exists(EVENTS_LOG) and os.path.getsize(EVENTS_LOG) >= EVENTS_LOG_MAX_BYTES:
            os.replace(EVENTS_LOG, f"{EVENTS_LOG}.1")
        with open(EVENTS_LOG, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


def atomic_write_jpeg(path: str, frame) -> str | None:
    temporary = f"{path}.{os.getpid()}.{secrets.token_hex(3)}.tmp.jpg"
    try:
        if not cv2.imwrite(temporary, frame):
            return None
        os.replace(temporary, path)
        return path
    except Exception:
        return None
    finally:
        try:
            if os.path.exists(temporary):
                os.unlink(temporary)
        except Exception:
            pass


def save_keyframe(frame) -> str | None:
    """Semantic transition keyframe in a bounded, atomically replaced ring."""
    global semantic_frame_sequence
    slot = semantic_frame_sequence % SEMANTIC_FRAME_SLOTS
    semantic_frame_sequence += 1
    return atomic_write_jpeg(os.path.join(FRAME_DIR, f"semantic-{slot:03d}.jpg"), frame)


def save_motion_keyframe(frame) -> str | None:
    """Write into a bounded ring so continuous perception cannot fill the disk."""
    global motion_frame_sequence
    slot = motion_frame_sequence % MOTION_FRAME_SLOTS
    motion_frame_sequence += 1
    path = os.path.join(FRAME_DIR, f"motion-{slot:02d}.jpg")
    return atomic_write_jpeg(path, frame)


class VisionSample:
    def __init__(self, present: bool, eye_closed=None, evidence=None):
        self.present = present
        self.eye_closed = eye_closed
        self.evidence = evidence or {}


def normalized_box(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> dict | None:
    """Return a bounded camera-relative box; never imply depth or metric position."""
    if width <= 0 or height <= 0:
        return None
    left = min(1.0, max(0.0, x1 / width))
    top = min(1.0, max(0.0, y1 / height))
    right = min(1.0, max(0.0, x2 / width))
    bottom = min(1.0, max(0.0, y2 / height))
    if right <= left or bottom <= top:
        return None
    return {
        "x": round(left, 6),
        "y": round(top, 6),
        "width": round(right - left, 6),
        "height": round(bottom - top, 6),
    }


class MediaPipeFaceDetector:
    """MediaPipe face presence + eye-blink evidence for person/drowsy detectors."""

    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            print(f"[vision] missing model {model_path} — download face_landmarker.task", file=sys.stderr)
            sys.exit(1)
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        self.mp = mp
        opts = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            output_face_blendshapes=True,
            num_faces=1,
            running_mode=mp_vision.RunningMode.IMAGE,
        )
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(opts)

    def detect(self, frame) -> VisionSample:
        rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = self.landmarker.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        face_present = len(result.face_landmarks) > 0
        eye_closed = None
        height, width = frame.shape[:2]
        if face_present and result.face_blendshapes:
            bs = {c.category_name: c.score for c in result.face_blendshapes[0]}
            eye_closed = (bs.get("eyeBlinkLeft", 0.0) + bs.get("eyeBlinkRight", 0.0)) / 2.0
        evidence = {"detector": "mediapipe_face", "frameWidth": width, "frameHeight": height}
        if face_present:
            landmarks = result.face_landmarks[0]
            box = normalized_box(
                min(point.x for point in landmarks) * width,
                min(point.y for point in landmarks) * height,
                max(point.x for point in landmarks) * width,
                max(point.y for point in landmarks) * height,
                width,
                height,
            )
            if box:
                evidence["box2d"] = box
        if eye_closed is not None:
            evidence["eyeClosed"] = round(float(eye_closed), 4)
        return VisionSample(face_present, eye_closed, evidence)


class YoloPersonDetector:
    """YOLOv8 person detector. Intended for robust full-body presence sensing."""

    def __init__(self, model_path: str):
        if not model_path:
            print("[vision] BUDDY_VISION_PERSON_BACKEND=yolo requires BUDDY_VISION_YOLO_MODEL or ~/vision_tests/yolov8n.onnx", file=sys.stderr)
            sys.exit(1)
        try:
            from ultralytics import YOLO
        except Exception as exc:
            print(f"[vision] ultralytics unavailable for YOLO backend: {exc}", file=sys.stderr)
            print("[vision] install with: BUDDY_VISION_INSTALL_YOLO=1 ./setup.sh", file=sys.stderr)
            sys.exit(1)
        self.model_path = model_path
        self.model = YOLO(model_path, task="detect")
        self.classes = parse_yolo_classes(YOLO_CLASSES)

    def detect(self, frame) -> VisionSample:
        kwargs = {
            "source": frame,
            "classes": self.classes,
            "conf": YOLO_CONF,
            "iou": YOLO_IOU,
            "verbose": False,
        }
        if YOLO_DEVICE:
            kwargs["device"] = YOLO_DEVICE
        result = self.model.predict(**kwargs)[0]
        best = None
        height, width = frame.shape[:2]
        if result.boxes is not None:
            for item in result.boxes:
                conf = float(item.conf[0].item())
                if best is None or conf > best["confidence"]:
                    xyxy = [float(v) for v in item.xyxy[0].tolist()]
                    best = {
                        "confidence": conf,
                        "box": {
                            "x1": round(xyxy[0], 2),
                            "y1": round(xyxy[1], 2),
                            "x2": round(xyxy[2], 2),
                            "y2": round(xyxy[3], 2),
                        },
                    }
        evidence = {
            "detector": "yolov8",
            "model": self.model_path,
            "confidence": round(best["confidence"], 4) if best else 0.0,
            "frameWidth": width,
            "frameHeight": height,
        }
        if best:
            evidence["box"] = best["box"]
            box = best["box"]
            evidence["box2d"] = normalized_box(
                box["x1"], box["y1"], box["x2"], box["y2"], width, height
            )
        return VisionSample(best is not None, None, evidence)


class PersonState:
    """Face present/lost → person_entered / person_lost (absence grace period)."""

    def __init__(self, episode_prefix: str = EPISODE_SESSION):
        self.present = False
        self.absent = 0
        self.grace = int(os.environ.get("BUDDY_VISION_PERSON_GRACE", "8"))
        self.episode_prefix = episode_prefix
        self.episode_sequence = 0
        self.presence_episode_id = None

    def update(self, face_present: bool):
        if face_present:
            self.absent = 0
            if not self.present:
                self.present = True
                self.episode_sequence += 1
                self.presence_episode_id = f"anon-{self.episode_prefix}-{self.episode_sequence}"
                return ("person_entered", 200, self.presence_episode_id)
        elif self.present:
            self.absent += 1
            if self.absent >= self.grace:
                self.present = False
                presence_episode_id = self.presence_episode_id
                self.presence_episode_id = None
                # Detection loss/occlusion is not proof that the person left
                # the physical room. The brain records this as unknown.
                return ("person_lost", 120, presence_episode_id)
        return None


class CameraLivenessState:
    """Low-rate camera health transitions plus a refresh before brain-side TTL expiry."""

    def __init__(self, heartbeat_secs: float | None = None, failure_grace: int | None = None):
        self.heartbeat_secs = min(10.0, max(
            1.0,
            heartbeat_secs if heartbeat_secs is not None
            else float(os.environ.get("BUDDY_VISION_HEARTBEAT_SECS", "5")),
        ))
        self.failure_grace = max(
            1,
            failure_grace if failure_grace is not None
            else int(os.environ.get("BUDDY_VISION_CAMERA_FAILURE_GRACE", "3")),
        )
        self.available = False
        self.unavailable_announced = False
        self.failures = 0
        self.last_alive_at = None
        self.last_unavailable_at = None

    def update(self, success: bool, at: float | None = None):
        current = time.monotonic() if at is None else at
        if success:
            recovered = not self.available
            self.available = True
            self.unavailable_announced = False
            self.failures = 0
            self.last_unavailable_at = None
            if recovered or self.last_alive_at is None or current - self.last_alive_at >= self.heartbeat_secs:
                self.last_alive_at = current
                return ("camera_alive", 10)
            return None
        self.failures += 1
        if self.failures >= self.failure_grace and not self.unavailable_announced:
            self.available = False
            self.unavailable_announced = True
            self.last_unavailable_at = current
            return ("camera_unavailable", 180)
        if (
            self.unavailable_announced
            and self.last_unavailable_at is not None
            and current - self.last_unavailable_at >= self.heartbeat_secs
        ):
            self.last_unavailable_at = current
            return ("camera_unavailable", 180)
        return None


class MotionEventState:
    """Rate-limit motion keyframes while keeping the first change responsive."""

    def __init__(self, cooldown_secs: float | None = None):
        self.cooldown_secs = max(
            2.0,
            cooldown_secs if cooldown_secs is not None
            else float(os.environ.get("BUDDY_VISION_MOTION_EVENT_SECS", "8")),
        )
        self.last_emitted_at = float("-inf")

    def should_emit(self, moved: bool, at: float | None = None) -> bool:
        if not moved:
            return False
        current = time.monotonic() if at is None else at
        if current - self.last_emitted_at < self.cooldown_secs:
            return False
        self.last_emitted_at = current
        return True


class DrowsyState:
    """Vigil pattern: eyes closed (eyeBlink blendshape ≥ thresh) for `secs` → drowsy.
    Re-arms when the eyes reopen (hysteresis). `eye_closed` is 0..1 or None (no face)."""

    def __init__(self):
        self.thresh = float(os.environ.get("BUDDY_VISION_BLINK", "0.5"))
        self.secs = float(os.environ.get("BUDDY_VISION_DROWSY_SECS", "2.0"))
        self.closed_since = None
        self.drowsy = False

    def update(self, eye_closed):
        if eye_closed is None:
            self.closed_since = None
            self.drowsy = False
            return None
        if eye_closed >= self.thresh:
            if self.closed_since is None:
                self.closed_since = time.time()
            elif not self.drowsy and (time.time() - self.closed_since) >= self.secs:
                self.drowsy = True
                return ("drowsy", 230)
        else:
            self.closed_since = None
            self.drowsy = False
        return None


def motion_score(prev, gray) -> float:
    if prev is None or prev.shape != gray.shape:
        return 0.0
    return float(np.mean(cv2.absdiff(prev, gray))) / 255.0


def parse_enabled_detectors() -> set[str]:
    return {
        item.strip().lower()
        for item in os.environ.get("BUDDY_VISION_DETECTORS", "person,drowsy").split(",")
        if item.strip()
    }


def parse_yolo_classes(value: str) -> list[int]:
    classes = []
    for raw in value.split(","):
        token = raw.strip()
        if not token:
            continue
        if not token.isdigit():
            print(f"[vision] ignoring non-numeric YOLO class '{token}' (use COCO ids; person=0)", file=sys.stderr)
            continue
        classes.append(int(token))
    return classes or [0]


def resolve_yolo_model() -> str:
    if YOLO_MODEL:
        return os.path.abspath(os.path.expanduser(YOLO_MODEL))
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.expanduser("~/vision_tests/yolov8n.onnx"),
        os.path.expanduser("~/vision_tests/yolov8n.pt"),
        os.path.join(here, "models", "yolov8n.onnx"),
        os.path.join(here, "models", "yolov8n.pt"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return ""


def create_detectors(enabled: set[str]):
    person_enabled = "person" in enabled
    drowsy_enabled = "drowsy" in enabled
    if not person_enabled and not drowsy_enabled:
        print(f"[vision] no supported detectors enabled: {sorted(enabled)}", file=sys.stderr)
        sys.exit(1)

    backend = PERSON_BACKEND
    if backend in ("face", "mediapipe_face"):
        backend = "mediapipe"
    if backend not in ("mediapipe", "yolo"):
        print(f"[vision] invalid BUDDY_VISION_PERSON_BACKEND={PERSON_BACKEND}; use mediapipe or yolo", file=sys.stderr)
        sys.exit(1)

    face_detector = None
    person_detector = None
    if drowsy_enabled or (person_enabled and backend == "mediapipe"):
        face_detector = MediaPipeFaceDetector(MODEL)
    if person_enabled:
        person_detector = YoloPersonDetector(resolve_yolo_model()) if backend == "yolo" else face_detector
    return backend, person_detector, face_detector


def main() -> None:
    bridge = Bridge(BRIDGE_URL, TOKEN)
    bridge.connect()
    enabled = parse_enabled_detectors()
    person = PersonState() if "person" in enabled else None
    drowsy = DrowsyState() if "drowsy" in enabled else None
    liveness = CameraLivenessState()
    motion_events = MotionEventState()
    observation_secs = min(
        10.0,
        max(0.25, float(os.environ.get("BUDDY_VISION_OBSERVATION_SECS", "1"))),
    )
    last_observation_at = float("-inf")
    backend, person_detector, face_detector = create_detectors(enabled)

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        bridge.emit(
            "camera_unavailable",
            180,
            {"camera": CAMERA_NAME, "confidence": 1.0, "reason": "open_failed"},
        )
        print(f"[vision] cannot open camera index {CAMERA_INDEX}", file=sys.stderr)
        sys.exit(1)
    print(f"[vision] watching camera {CAMERA_INDEX} ({CAMERA_NAME}); detectors={sorted(enabled)} person_backend={backend}", flush=True)

    prev_gray = None
    interval = 1.0 / max(FPS, 0.5)
    while True:
        t0 = time.time()
        ok, frame = cap.read()
        if not ok:
            transition = liveness.update(False)
            if transition:
                bridge.emit(
                    transition[0],
                    transition[1],
                    {"camera": CAMERA_NAME, "confidence": 1.0},
                )
            time.sleep(0.5)
            continue
        height, width = frame.shape[:2]
        transition = liveness.update(True)
        if transition:
            bridge.emit(
                transition[0],
                transition[1],
                {
                    "camera": CAMERA_NAME,
                    "confidence": 1.0,
                    "frameWidth": width,
                    "frameHeight": height,
                },
            )
        gray = cv2.cvtColor(cv2.resize(frame, (160, 120)), cv2.COLOR_BGR2GRAY)
        score = motion_score(prev_gray, gray)
        moved = score >= MOTION_THRESH
        prev_gray = gray
        if motion_events.should_emit(moved):
            keyframe = save_motion_keyframe(frame)
            if keyframe:
                payload = {
                    "camera": CAMERA_NAME,
                    "imagePath": keyframe,
                    "motionScore": round(score, 4),
                    "frameWidth": width,
                    "frameHeight": height,
                }
                bridge.emit("motion", 80, payload)
                log_event({"ts_ms": now_ms(), "kind": "motion", **payload})
        # Cheap gate: run inference on motion, or while a person is present (to
        # catch drowsiness even when they're sitting still).
        if moved or (person and person.present):
            face_sample = face_detector.detect(frame) if face_detector else None
            if person_detector is None:
                person_sample = VisionSample(False)
            elif person_detector is face_detector:
                person_sample = face_sample or VisionSample(False)
            else:
                person_sample = person_detector.detect(frame)

            transitions = []
            if person:
                t = person.update(person_sample.present)
                if t:
                    transitions.append((t[0], t[1], person_sample.evidence, t[2]))
            if drowsy:
                eye_closed = face_sample.eye_closed if face_sample and face_sample.present else None
                t = drowsy.update(eye_closed)
                if t:
                    transitions.append((
                        t[0],
                        t[1],
                        face_sample.evidence if face_sample else {"detector": "mediapipe_face"},
                        person.presence_episode_id if person else None,
                    ))
            for kind, salience, evidence, presence_episode_id in transitions:
                keyframe = save_keyframe(frame)
                payload = {"camera": CAMERA_NAME, "imagePath": keyframe, **evidence}
                if presence_episode_id:
                    payload["presenceEpisodeId"] = presence_episode_id
                bridge.emit(kind, salience, payload)
                log_event({"ts_ms": now_ms(), "kind": kind, **payload})
                print(f"[vision] event {kind} → bridge", flush=True)
            if (
                person
                and person.present
                and person_sample.present
                and person.presence_episode_id
                and t0 - last_observation_at >= observation_secs
            ):
                last_observation_at = t0
                bridge.emit(
                    "person_observed",
                    20,
                    {
                        "camera": CAMERA_NAME,
                        "presenceEpisodeId": person.presence_episode_id,
                        **person_sample.evidence,
                    },
                )
        dt = time.time() - t0
        if dt < interval:
            time.sleep(interval - dt)


if __name__ == "__main__":
    main()
