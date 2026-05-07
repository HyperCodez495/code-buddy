/**
 * Shared helpers used by both EnrollmentDialog (one-off captures) and
 * PresenceService (continuous loop): pick the largest face from a
 * detection list, and crop the bounding box to a 112×112 RGB Uint8Array
 * suitable for `presence.encode`.
 *
 * Kept separate from face-detector.ts because these are pure DOM/canvas
 * utilities — they don't depend on MediaPipe and shouldn't pull it in.
 *
 * @module cowork/renderer/services/presence/face-utils
 */

import type { FaceDetection } from '../../../shared/presence/types';

/** Buffalo_S input crop size. Hardcoded — must match the ONNX model. */
export const CROP_SIZE = 112;

/**
 * Pick the largest face by bounding box area. Used for both enrollment
 * (capture only the dominant face when multiple are present) and
 * recognition (the largest face is also the closest to the camera =
 * most likely the user).
 */
export function largestFace(detections: FaceDetection[]): FaceDetection {
  return detections.reduce((biggest, d) => {
    const a = d.boundingBox.width * d.boundingBox.height;
    const b = biggest.boundingBox.width * biggest.boundingBox.height;
    return a > b ? d : biggest;
  });
}

/**
 * Crop the detected face from the video frame, resize to 112×112,
 * return raw RGB bytes ready for `presence.encode`. We pad the
 * bounding box by 20% on each side because BlazeFace's box is tight on
 * the face — ArcFace was trained on aligned faces with a bit of
 * context (forehead + chin).
 */
export function cropFaceToRgbBytes(
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
