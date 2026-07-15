/**
 * Voicebox-inspired system dictation for Cowork.
 *
 * The global shortcut is owned by Electron main. This resident renderer
 * captures audio without taking focus, transcribes through Cowork's local STT,
 * then asks main to paste into the application that remains focused.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic, TriangleAlert } from 'lucide-react';
import { interruptSpeech } from './VoiceOutputToggle';

type DictationPhase = 'idle' | 'recording' | 'transcribing' | 'pasting' | 'done' | 'error';

const MAX_RECORDING_MS = 5 * 60_000;

export function GlobalDictationOverlay() {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [detail, setDetail] = useState('');
  const acceleratorRef = useRef('Ctrl+Shift+Space');
  const phaseRef = useRef<DictationPhase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveTo = (next: DictationPhase, nextDetail = ''): void => {
    phaseRef.current = next;
    setPhase(next);
    setDetail(nextDetail);
  };

  useEffect(() => {
    let disposed = false;
    const api = window.electronAPI?.voice;
    void api?.dictationStatus?.().then((status) => {
      if (!disposed && status.accelerator) {
        acceleratorRef.current = status.accelerator;
      }
    }).catch(() => undefined);

    const stopTracks = (): void => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (hardStopRef.current) clearTimeout(hardStopRef.current);
      hardStopRef.current = null;
    };

    const dismissLater = (): void => {
      if (dismissRef.current) clearTimeout(dismissRef.current);
      dismissRef.current = setTimeout(() => moveTo('idle'), 2_500);
    };

    const finish = async (blob: Blob): Promise<void> => {
      const voice = window.electronAPI?.voice;
      if (!voice?.transcribe || !voice.pasteDictation) {
        moveTo('error', 'Pont de dictée indisponible');
        dismissLater();
        return;
      }
      try {
        moveTo('transcribing', 'Transcription locale…');
        const result = await voice.transcribe(await blob.arrayBuffer(), { language: 'fr' });
        if (!result.ok || !result.text?.trim()) {
          throw new Error(result.error ?? 'Aucune parole reconnue');
        }
        moveTo('pasting', 'Insertion dans l’application…');
        const paste = await voice.pasteDictation(result.text);
        if (!paste.ok) throw new Error(paste.error ?? 'Insertion impossible');
        moveTo(
          'done',
          paste.pasted
            ? `Texte inséré (${paste.mechanism})`
            : paste.error ?? 'Texte copié dans le presse-papiers'
        );
      } catch (error) {
        moveTo('error', error instanceof Error ? error.message : String(error));
      } finally {
        dismissLater();
      }
    };

    const stop = (): void => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;
      moveTo('transcribing', 'Transcription locale…');
      recorder.stop();
    };

    const start = async (): Promise<void> => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'error' && phaseRef.current !== 'done') return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        moveTo('error', 'Capture microphone indisponible');
        dismissLater();
        return;
      }
      if (dismissRef.current) clearTimeout(dismissRef.current);
      interruptSpeech('barge_in');
      moveTo('recording', `Parle, puis appuie encore sur ${acceleratorRef.current}`);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          stopTracks();
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          chunksRef.current = [];
          recorderRef.current = null;
          if (blob.size === 0) {
            moveTo('error', 'Enregistrement vide');
            dismissLater();
            return;
          }
          void finish(blob);
        };
        recorder.start(250);
        hardStopRef.current = setTimeout(stop, MAX_RECORDING_MS);
      } catch (error) {
        stopTracks();
        moveTo('error', error instanceof Error ? error.message : String(error));
        dismissLater();
      }
    };

    const unsubscribe = window.electronAPI?.onEvent?.((event) => {
      if (event.type !== 'voice.dictation.toggle') return;
      acceleratorRef.current = event.payload.accelerator;
      if (recorderRef.current?.state === 'recording') stop();
      else void start();
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      if (dismissRef.current) clearTimeout(dismissRef.current);
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      stopTracks();
    };
  }, []);

  if (phase === 'idle') return null;
  const Icon = phase === 'recording'
    ? Mic
    : phase === 'done'
      ? CheckCircle2
      : phase === 'error'
        ? TriangleAlert
        : Loader2;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="global-dictation-pill"
      className={`pointer-events-none fixed bottom-6 left-1/2 z-[120] flex max-w-[min(90vw,620px)] -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2.5 shadow-xl backdrop-blur ${
        phase === 'error'
          ? 'border-error/40 bg-error/90 text-white'
          : phase === 'done'
            ? 'border-success/40 bg-success/90 text-white'
            : 'border-border bg-surface/95 text-foreground'
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${['transcribing', 'pasting'].includes(phase) ? 'animate-spin' : phase === 'recording' ? 'animate-pulse' : ''}`} />
      <div className="min-w-0">
        <div className="text-xs font-semibold">
          {phase === 'recording' ? 'Dictée en cours' : phase === 'done' ? 'Dictée terminée' : phase === 'error' ? 'Dictée interrompue' : 'Dictée locale'}
        </div>
        <div className="truncate text-[11px] opacity-80">{detail}</div>
      </div>
    </div>
  );
}
