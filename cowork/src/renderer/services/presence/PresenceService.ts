/**
 * PresenceService — renderer-side daemon that runs the continuous
 * "who's in front of the camera" loop.
 *
 * Without this service, presence enrollment works (one-shot via the
 * EnrollmentDialog), but after the dialog closes the camera is released
 * and `presence:detected` events never fire — so the Code Buddy core
 * agent never receives a fresh `<presence>` block in its system prompt.
 *
 * The service is a singleton (App.tsx wires lifecycle once at mount).
 * It is *not* tied to a React component's mount cycle: closing/opening
 * the EnrollmentDialog should never restart it.
 *
 * Lifecycle (managed by App.tsx):
 *   1. App starts → if `presenceEnabled` is true → call `start()`.
 *   2. `start()` self-aborts if no model installed OR no identities
 *      enrolled — we don't take the camera light just to do nothing.
 *   3. `visibilitychange = hidden` → `pause()` (keeps stream open).
 *   4. `visibilitychange = visible` → `resume()`.
 *   5. App unmounts (Electron quit) → `stop()` releases the stream.
 *
 * Per-tick pipeline:
 *   - FaceDetector.detect(video)
 *   - if no face → skip tick (no IPC call)
 *   - largest face → crop 112×112 RGB
 *   - presence.encode (main process, ONNX Runtime)
 *   - presence.match (main process, cosine vs store)
 *   - main process emits `presence:detected` / `presence:left` events
 *     to the cross-process file consumed by the core agent
 *
 * Error policy: per-tick errors are silently swallowed (encode
 * occasionally throws on resolution mismatches). After
 * `MAX_CONSECUTIVE_ERRORS` consecutive failures, the loop stops and
 * the state moves to `'error'`.
 *
 * @module cowork/renderer/services/presence/PresenceService
 */

import { createFaceDetector, FaceDetector } from './face-detector';
import { cropFaceToRgbBytes, largestFace } from './face-utils';

export type PresenceServiceState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'permission-denied'
  | 'no-model'
  | 'no-enrollment'
  | 'error';

export interface PresenceServiceOptions {
  /** Period between two detection ticks. Default 3000 ms. */
  intervalMs?: number;
  /** Match threshold, forwarded to presence.match. Default: store default. */
  matchThreshold?: number;
}

const DEFAULT_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_ERRORS = 10;

type StateListener = (state: PresenceServiceState) => void;

interface PresenceAPI {
  hasModel: () => Promise<{ installed: boolean; path: string }>;
  list: () => Promise<unknown[]>;
  encode: (payload: { rgbBytes: number[] }) => Promise<number[]>;
  match: (payload: { embedding: number[]; threshold?: number }) => Promise<unknown>;
}

function getPresenceAPI(): PresenceAPI | null {
  const api = (window as Window & {
    electronAPI?: { presence?: PresenceAPI };
  }).electronAPI;
  return api?.presence ?? null;
}

export class PresenceService {
  private static instance: PresenceService | null = null;

  static getInstance(options?: PresenceServiceOptions): PresenceService {
    if (PresenceService.instance === null) {
      PresenceService.instance = new PresenceService(options);
    }
    return PresenceService.instance;
  }

  /** For tests only — drops the singleton so the next getInstance() rebuilds. */
  static resetForTesting(): void {
    if (PresenceService.instance) {
      PresenceService.instance.stop();
    }
    PresenceService.instance = null;
  }

  private state: PresenceServiceState = 'idle';
  private detector: FaceDetector | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<StateListener>();
  private consecutiveErrors = 0;
  private readonly intervalMs: number;
  private readonly matchThreshold?: number;

  constructor(options: PresenceServiceOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.matchThreshold = options.matchThreshold;
  }

  getState(): PresenceServiceState {
    return this.state;
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: PresenceServiceState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // Listener errors must not break the state machine.
      }
    }
  }

  /**
   * Start the loop. No-op if already running. Honours guards:
   *   - electronAPI absent (browser dev mode) → state remains `idle`
   *   - no model installed → state `no-model`
   *   - no enrolled identities → state `no-enrollment`
   *   - camera permission denied → state `permission-denied`
   * In any of those terminal states, `start()` does NOT acquire the
   * webcam.
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;

    this.setState('starting');
    const api = getPresenceAPI();
    if (!api) {
      // Likely a non-Electron build (vite preview, browser dev). Stay
      // idle silently — no UI noise.
      this.setState('idle');
      return;
    }

    try {
      const modelStatus = await api.hasModel();
      if (!modelStatus.installed) {
        this.setState('no-model');
        return;
      }

      const enrolled = await api.list();
      if (!Array.isArray(enrolled) || enrolled.length === 0) {
        this.setState('no-enrollment');
        return;
      }
    } catch {
      this.setState('error');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch {
      this.setState('permission-denied');
      return;
    }

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      // Autoplay can fail in some renderers — the next tick will retry.
    }

    this.detector = createFaceDetector({ runningMode: 'VIDEO', delegate: 'GPU' });
    try {
      await this.detector.initialize();
    } catch {
      this.cleanupResources();
      this.setState('error');
      return;
    }

    this.consecutiveErrors = 0;
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.setState('running');
  }

  /**
   * Stop the loop, release the camera stream and detector. After
   * `stop()`, `start()` is needed to resume — `pause()` is the
   * lighter-weight alternative for visibility transitions.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.cleanupResources();
    this.setState('idle');
  }

  /**
   * Pause the tick loop without releasing the camera. Used on
   * visibilitychange = hidden — re-acquiring the webcam on resume
   * would cause a noticeable delay and an extra "camera light"
   * blip.
   */
  pause(): void {
    if (this.state !== 'running') return;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.setState('paused');
  }

  /** Resume from pause. No-op if not paused. */
  resume(): void {
    if (this.state !== 'paused') return;
    this.consecutiveErrors = 0;
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.setState('running');
  }

  private cleanupResources(): void {
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video = null;
  }

  private async tick(): Promise<void> {
    if (this.state !== 'running') return;
    const api = getPresenceAPI();
    if (!api || !this.detector || !this.video) return;

    try {
      const detections = await this.detector.detect(this.video);
      if (detections.length === 0) {
        // No face — perfectly fine, just skip. Resets the error counter
        // because "no face" is not a failure.
        this.consecutiveErrors = 0;
        return;
      }
      const face = largestFace(detections);
      const rgb = cropFaceToRgbBytes(this.video, face);
      const embedding = await api.encode({ rgbBytes: Array.from(rgb) });
      await api.match({
        embedding,
        ...(this.matchThreshold !== undefined ? { threshold: this.matchThreshold } : {}),
      });
      this.consecutiveErrors = 0;
    } catch {
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        if (this.intervalHandle !== null) {
          clearInterval(this.intervalHandle);
          this.intervalHandle = null;
        }
        this.cleanupResources();
        this.setState('error');
      }
    }
  }
}
