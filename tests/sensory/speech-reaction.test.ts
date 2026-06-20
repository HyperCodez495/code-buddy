import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { wireSpeechReaction, type Transcriber } from '../../src/sensory/speech-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function speechEnd(wav?: string): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'speech_end', payload: wav ? { wav } : {} },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('speech reaction — speech_end → STT → percept', () => {
  it('transcribes the utterance once, records a hearing percept, fires onHeard', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let calls = 0;
    const transcriber: Transcriber = async () => {
      calls += 1;
      return 'Bonjour Patrice';
    };
    let heard = '';
    let clock = 1000;
    const unwire = wireSpeechReaction({
      transcriber,
      debounceMs: 3000,
      cwd: tmp,
      now: () => clock,
      onHeard: (t) => {
        heard = t;
      },
    });
    try {
      speechEnd('/tmp/x.wav');
      await tick();
      expect(calls).toBe(1);
      expect(heard).toBe('Bonjour Patrice');

      speechEnd('/tmp/x.wav');
      await tick();
      expect(calls).toBe(1); // within debounce → one transcription per utterance

      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      expect(percepts).toContain('Bonjour Patrice');
      expect(percepts).toContain('sensory_speech_reaction');
    } finally {
      unwire();
    }
  });

  it('ignores speech_end with no wav, and non-speech events', async () => {
    let calls = 0;
    const transcriber: Transcriber = async () => {
      calls += 1;
      return 'x';
    };
    const unwire = wireSpeechReaction({ transcriber, debounceMs: 0 });
    try {
      speechEnd(); // no wav → can't transcribe
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'audio', kind: 'speech_start', payload: { wav: '/tmp/x.wav' } } });
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 1 } } });
      await tick();
      expect(calls).toBe(0);
    } finally {
      unwire();
    }
  });
});
