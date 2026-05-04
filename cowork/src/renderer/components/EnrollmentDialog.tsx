/**
 * EnrollmentDialog — capture 5 face samples and persist a new identity.
 *
 * Flow:
 *   1. User opens the dialog, allows webcam access.
 *   2. The component initialises `FaceDetector` (MediaPipe BlazeFace) and
 *      starts a render loop on the live `<video>` stream.
 *   3. The user types a name + optional aliases (comma-separated).
 *   4. The user clicks "Capture" five times — each click crops the
 *      current largest detected face to 112×112 RGB, ships it to main
 *      via `presence.encode`, and stages the embedding locally.
 *   5. On the 5th sample, the component calls `presence.enroll` with
 *      the first sample (the rest are added via `presence.addSample`,
 *      so the rolling-average store stays consistent).
 *
 * Minimal V0 UX: no avatar preview, no auto-capture, no quality scoring.
 * Just "name, capture, save". The polished flow can iterate later.
 *
 * @module cowork/renderer/components/EnrollmentDialog
 */

import { useEffect, useRef, useState } from 'react';
import {
  FaceDetector,
  createFaceDetector,
} from '../services/presence/face-detector';
import type { FaceDetection } from '../../shared/presence/types';

const SAMPLES_REQUIRED = 5;
const CROP_SIZE = 112;

// Window.electronAPI.presence is declared in cowork/src/preload/index.ts
// (the canonical declaration also lives there for every other API surface
// — keeping the contract in one file avoids duplicate-declaration errors).

export interface EnrollmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolled?: (personId: string) => void;
}

export function EnrollmentDialog({ isOpen, onClose, onEnrolled }: EnrollmentDialogProps) {
  const [name, setName] = useState('');
  const [aliasesInput, setAliasesInput] = useState('');
  const [samplesCaught, setSamplesCaught] = useState(0);
  const [status, setStatus] = useState<'idle' | 'starting' | 'ready' | 'capturing' | 'saving' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestDetection, setLatestDetection] = useState<FaceDetection | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stagedEmbeddings = useRef<number[][]>([]);
  const personIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // Bootstrap: webcam + detector. Tear down on close/unmount.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setStatus('starting');
    setErrorMsg(null);

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = createFaceDetector({ runningMode: 'VIDEO', delegate: 'GPU' });
        await detector.initialize();
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
        setStatus('ready');
        loop();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg((err as Error).message);
          setStatus('error');
        }
      }
    };

    const loop = async () => {
      if (cancelled || !detectorRef.current || !videoRef.current) return;
      try {
        const detections = await detectorRef.current.detect(videoRef.current);
        if (detections.length > 0) {
          setLatestDetection(largestFace(detections));
        } else {
          setLatestDetection(null);
        }
      } catch {
        // Detection occasionally throws on resolution mismatches — skip frame.
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      detectorRef.current?.close();
      detectorRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      stagedEmbeddings.current = [];
      personIdRef.current = null;
      setSamplesCaught(0);
      setStatus('idle');
      setLatestDetection(null);
    };
  }, [isOpen]);

  const handleCapture = async () => {
    if (!latestDetection || !videoRef.current || !window.electronAPI) {
      setErrorMsg('No face detected — face the camera squarely and retry.');
      return;
    }
    setStatus('capturing');
    try {
      const rgbBytes = cropFaceToRgbBytes(videoRef.current, latestDetection);
      const embedding = await window.electronAPI.presence.encode({
        rgbBytes: Array.from(rgbBytes),
      });
      stagedEmbeddings.current.push(embedding);
      setSamplesCaught(stagedEmbeddings.current.length);

      if (stagedEmbeddings.current.length >= SAMPLES_REQUIRED) {
        setStatus('saving');
        await persistAll();
        setStatus('done');
        onEnrolled?.(personIdRef.current ?? '');
      } else {
        setStatus('ready');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  };

  const persistAll = async () => {
    if (!window.electronAPI) throw new Error('electronAPI unavailable');
    const aliases = aliasesInput
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const [first, ...rest] = stagedEmbeddings.current;

    const enrolled = (await window.electronAPI.presence.enroll({
      name: name.trim(),
      aliases,
      embedding: first,
    })) as { id: string };
    personIdRef.current = enrolled.id;

    for (const emb of rest) {
      await window.electronAPI.presence.addSample({
        personId: enrolled.id,
        embedding: emb,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[640px] max-w-[90vw] rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900 dark:text-zinc-100">
        <h2 className="text-lg font-semibold mb-4">Enregistrer un visage</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm">
              Nom
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Patrice"
                className="block w-full rounded border px-2 py-1 dark:bg-zinc-800"
              />
            </label>
            <label className="text-sm">
              Alias (séparés par des virgules)
              <input
                type="text"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder="mon chéri, patron"
                className="block w-full rounded border px-2 py-1 dark:bg-zinc-800"
              />
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Les alias sont des registres alternatifs que l'IA peut utiliser pour
              vous saluer selon le contexte. Optionnels — vous pouvez n'en mettre aucun.
            </p>

            <div className="text-sm">
              Échantillons : <strong>{samplesCaught} / {SAMPLES_REQUIRED}</strong>
            </div>

            {status === 'error' && errorMsg && (
              <div className="text-sm text-red-600">Erreur : {errorMsg}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCapture}
                disabled={
                  status !== 'ready' ||
                  !latestDetection ||
                  !name.trim() ||
                  samplesCaught >= SAMPLES_REQUIRED
                }
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
              >
                Capturer
              </button>
              <button
                onClick={onClose}
                className="rounded border px-3 py-1 dark:border-zinc-700"
              >
                {status === 'done' ? 'Fermer' : 'Annuler'}
              </button>
            </div>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {latestDetection && (
              <div
                className="pointer-events-none absolute border-2 border-cyan-400"
                style={{
                  left: `${(latestDetection.boundingBox.x / 640) * 100}%`,
                  top: `${(latestDetection.boundingBox.y / 480) * 100}%`,
                  width: `${(latestDetection.boundingBox.width / 640) * 100}%`,
                  height: `${(latestDetection.boundingBox.height / 480) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function largestFace(detections: FaceDetection[]): FaceDetection {
  return detections.reduce((biggest, d) => {
    const a = d.boundingBox.width * d.boundingBox.height;
    const b = biggest.boundingBox.width * biggest.boundingBox.height;
    return a > b ? d : biggest;
  });
}

/**
 * Crop the detected face from the video frame, resize to 112×112, return
 * raw RGB bytes ready for `presence.encode`. We pad the bounding box by
 * 20% on each side because BlazeFace's box is tight on the face — ArcFace
 * was trained on aligned faces with a bit of context (forehead + chin).
 */
function cropFaceToRgbBytes(
  video: HTMLVideoElement,
  detection: FaceDetection,
): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const pad = 0.2;
  const { x, y, width, height } = detection.boundingBox;
  const padX = width * pad;
  const padY = height * pad;

  ctx.drawImage(
    video,
    Math.max(0, x - padX),
    Math.max(0, y - padY),
    width + padX * 2,
    height + padY * 2,
    0,
    0,
    CROP_SIZE,
    CROP_SIZE,
  );

  const imageData = ctx.getImageData(0, 0, CROP_SIZE, CROP_SIZE);
  // imageData.data is RGBA; we want RGB only.
  const rgb = new Uint8Array(CROP_SIZE * CROP_SIZE * 3);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    rgb[j] = imageData.data[i];
    rgb[j + 1] = imageData.data[i + 1];
    rgb[j + 2] = imageData.data[i + 2];
  }
  return rgb;
}
