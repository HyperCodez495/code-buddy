//! Live-microphone audio sense — the robot's real-time ears.
//!
//! Opt-in behind the `live-audio` feature (which pulls in `stt`). Captures the
//! microphone CONTINUOUSLY via ffmpeg (`-f pulse`, already a dependency used by
//! the camera sense — so no `cpal`, no `libasound2-dev`, no sudo), runs a
//! streaming energy-VAD endpointer to carve the stream into utterances, decodes
//! each closed utterance with the in-process offline recognizer (`stt.rs`,
//! ~120 ms) and emits an `audio/transcript_final` `SensoryEvent` whose payload
//! already carries the text — so the Code Buddy side consumes it directly with
//! no WAV round-trip and no python.
//!
//! The recognizer model is OFFLINE (NeMo Parakeet-TDT), so there is no
//! frame-by-frame `transcript_partial`; we emit the final per utterance only.
//! Latency is dominated by the VAD endpoint silence (`BUDDY_SENSE_MIC_ENDPOINT_MS`),
//! not by the ~120 ms decode.
//!
//! Capture + decode run on a dedicated blocking thread (via `spawn_blocking`):
//! the recognizer is `!Send`, so keeping it off the async runtime avoids holding
//! it across an `.await`.

use crate::event::{Modality, SensoryEvent};
use crate::senses::audio::rms_i16;
use std::io::Read;
use std::process::{Command, Stdio};
use tokio::sync::mpsc;

const SPEECH_SALIENCE: u8 = 200; // a final transcript is salient → never coalesced
const SAMPLE_RATE: u32 = 16_000;
const FRAME_MS: u64 = 20; // 20 ms frames → 320 samples @ 16 kHz
/// Default energy-VAD threshold (normalized RMS) to OPEN an utterance. Biased low
/// on purpose: a false positive costs one wasted ~120 ms decode (empty text →
/// skipped), a false negative makes the robot deaf. Conversational mic speech sits
/// well under a studio recording, so we open easily and let the decode gate noise.
/// The shared const ties the runtime default and the real-WAV test together.
pub const DEFAULT_MIC_THRESHOLD: f64 = 0.02;
/// Default trailing silence that closes an utterance.
pub const DEFAULT_MIC_ENDPOINT_MS: u64 = 700;
/// Lead-in kept before speech is detected, so we don't clip the first phoneme.
const PREROLL_MS: u64 = 300;
/// Ignore "utterances" with less than this much voiced audio (clicks, coughs).
const MIN_SPEECH_MS: u64 = 200;
/// Hard cap on a single utterance → force a decode (bounds memory + latency).
const MAX_UTTERANCE_MS: u64 = 15_000;

fn frame_samples() -> usize {
    ((SAMPLE_RATE as u64 * FRAME_MS) / 1000) as usize
}

/// Streaming endpointer. Feed it fixed-size frames; it returns `Some(utterance)`
/// (mono i16 @ 16 kHz, pre-roll included) when an utterance closes — i.e. speech
/// followed by `endpoint_ms` of silence, or the max-length cap. Pure + testable;
/// no I/O, no model.
pub struct Segmenter {
    threshold: f64,
    t_low: f64,
    endpoint_frames: u32,
    min_voiced_frames: u32,
    max_frames: u32,
    preroll_cap: usize,
    speaking: bool,
    silence_run: u32,
    voiced_frames: u32,
    buf: Vec<i16>,
    preroll: std::collections::VecDeque<Vec<i16>>,
}

impl Segmenter {
    pub fn new(threshold: f64, frame_ms: u64, endpoint_ms: u64) -> Self {
        let per = |ms: u64| (ms / frame_ms.max(1)).max(1) as u32;
        Self {
            threshold,
            // Hysteresis: enter at `threshold`, only treat as silence below t_low.
            t_low: threshold * 0.6,
            endpoint_frames: per(endpoint_ms),
            min_voiced_frames: per(MIN_SPEECH_MS),
            max_frames: per(MAX_UTTERANCE_MS),
            preroll_cap: (PREROLL_MS / frame_ms.max(1)).max(1) as usize,
            speaking: false,
            silence_run: 0,
            voiced_frames: 0,
            buf: Vec::new(),
            preroll: std::collections::VecDeque::new(),
        }
    }

    /// Push one frame. Returns the finished utterance when one closes.
    pub fn push(&mut self, frame: &[i16]) -> Option<Vec<i16>> {
        let rms = rms_i16(frame);
        if !self.speaking {
            // Keep a short rolling lead-in so the first phoneme isn't clipped.
            self.preroll.push_back(frame.to_vec());
            while self.preroll.len() > self.preroll_cap {
                self.preroll.pop_front();
            }
            if rms >= self.threshold {
                self.speaking = true;
                self.silence_run = 0;
                self.voiced_frames = 1;
                self.buf.clear();
                // `frame` is already the newest element of the pre-roll (pushed
                // just above), so draining the pre-roll covers it — don't append
                // it again or the first 20 ms is doubled.
                for f in self.preroll.drain(..) {
                    self.buf.extend_from_slice(&f);
                }
            }
            return None;
        }

        // Speaking: accumulate, track trailing silence for endpointing.
        self.buf.extend_from_slice(frame);
        if rms >= self.t_low {
            self.silence_run = 0;
            self.voiced_frames += 1;
        } else {
            self.silence_run += 1;
        }

        let frames = (self.buf.len() / frame_samples().max(1)) as u32;
        let ended = self.silence_run >= self.endpoint_frames;
        let capped = frames >= self.max_frames;
        if ended || capped {
            let accepted = self.voiced_frames >= self.min_voiced_frames;
            let utt = std::mem::take(&mut self.buf);
            self.speaking = false;
            self.silence_run = 0;
            self.voiced_frames = 0;
            self.preroll.clear();
            return if accepted { Some(utt) } else { None };
        }
        None
    }

    /// Stream ended mid-utterance → flush whatever we have if it's long enough.
    pub fn flush(&mut self) -> Option<Vec<i16>> {
        if self.speaking && self.voiced_frames >= self.min_voiced_frames {
            self.speaking = false;
            Some(std::mem::take(&mut self.buf))
        } else {
            None
        }
    }
}

fn ffmpeg_bin() -> String {
    std::env::var("BUDDY_SENSE_FFMPEG").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "ffmpeg".to_string())
}

/// Spawn the sense: a blocking capture+decode loop on its own thread (the
/// recognizer is `!Send`). `source` is a PulseAudio source name (or "default").
pub async fn run(tx: mpsc::Sender<SensoryEvent>, source: String, threshold: f64, endpoint_ms: u64) {
    let _ = tokio::task::spawn_blocking(move || capture_loop(tx, source, threshold, endpoint_ms)).await;
}

fn capture_loop(tx: mpsc::Sender<SensoryEvent>, source: String, threshold: f64, endpoint_ms: u64) {
    // Load the recognizer ONCE (≈1–2 s). On failure, log loudly and bow out so
    // the daemon keeps beating instead of going deaf with a panic.
    let model_dir = crate::senses::stt::resolve_model_dir();
    let mut stt = match crate::senses::stt::Stt::load(&model_dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[buddy-sense] live-audio: recognizer load failed ({e}); sense disabled");
            return;
        }
    };
    eprintln!("[buddy-sense] live-audio: recognizer ready ({model_dir})");

    let mut child = match Command::new(ffmpeg_bin())
        .args([
            "-hide_banner", "-loglevel", "error",
            "-f", "pulse", "-i", &source,
            "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[buddy-sense] live-audio: ffmpeg spawn failed ({e}); is ffmpeg installed? sense disabled");
            return;
        }
    };
    let mut out = match child.stdout.take() {
        Some(o) => o,
        None => {
            eprintln!("[buddy-sense] live-audio: no ffmpeg stdout; sense disabled");
            let _ = child.kill();
            return;
        }
    };

    let n = frame_samples();
    let mut bytes = vec![0u8; n * 2];
    let mut seg = Segmenter::new(threshold, FRAME_MS, endpoint_ms);
    eprintln!("[buddy-sense] live-audio: listening (pulse:{source})");

    loop {
        if out.read_exact(&mut bytes).is_err() {
            break; // ffmpeg ended / EOF
        }
        let frame: Vec<i16> = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        if let Some(utt) = seg.push(&frame) {
            if !emit_utterance(&mut stt, &tx, utt) {
                break;
            }
        }
    }
    if let Some(utt) = seg.flush() {
        let _ = emit_utterance(&mut stt, &tx, utt);
    }
    let _ = child.kill();
    eprintln!("[buddy-sense] live-audio: capture ended");
}

/// Decode one utterance and push a `transcript_final`. Returns false if the bus
/// is closed (→ stop the loop).
fn emit_utterance(stt: &mut crate::senses::stt::Stt, tx: &mpsc::Sender<SensoryEvent>, utt: Vec<i16>) -> bool {
    let ms = (utt.len() as u64 * 1000) / SAMPLE_RATE as u64;
    let text = stt.transcribe_pcm(SAMPLE_RATE, &utt);
    if text.is_empty() {
        return true; // silence / non-speech that slipped the gate — skip quietly
    }
    // Validation aid: `BUDDY_SENSE_MIC_DEBUG=1` echoes each final to stderr so you
    // can speak and see the transcript at the terminal, without a bus consumer.
    if std::env::var("BUDDY_SENSE_MIC_DEBUG").is_ok() {
        eprintln!("[buddy-sense] live-audio transcript ({ms}ms): {text}");
    }
    let ev = SensoryEvent::new(
        Modality::Audio,
        "transcript_final",
        SPEECH_SALIENCE,
        serde_json::json!({ "text": text, "ms": ms }),
    );
    tx.blocking_send(ev).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames_of(level: i16, count: usize) -> Vec<Vec<i16>> {
        let n = frame_samples();
        (0..count).map(|_| vec![level; n]).collect()
    }

    #[test]
    fn segments_one_utterance_from_silence_speech_silence() {
        // endpoint 100 ms = 5 frames of silence closes the utterance.
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = Vec::new();
        // 3 silence, 20 loud (≈400 ms > MIN_SPEECH 200 ms), then silence to endpoint.
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 20));
        stream.extend(frames_of(0, 8));
        for f in &stream {
            if let Some(utt) = seg.push(f) {
                closed.push(utt);
            }
        }
        assert_eq!(closed.len(), 1, "exactly one utterance should close");
        // Pre-roll (≤15 frames) + 20 voiced + trailing silence up to endpoint (5).
        let got = closed[0].len() / frame_samples();
        assert!(got >= 20 && got <= 20 + 15 + 6, "unexpected utterance span: {got} frames");
    }

    #[test]
    fn pure_silence_yields_nothing() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        for f in frames_of(0, 100) {
            if seg.push(&f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 0);
    }

    #[test]
    fn rejects_too_short_a_blip() {
        // A 60 ms blip (3 frames) is below MIN_SPEECH_MS (200 ms) → discarded.
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 3)); // 60 ms blip
        stream.extend(frames_of(0, 8)); // silence past endpoint
        for f in &stream {
            if seg.push(f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 0, "a sub-200 ms blip must not produce an utterance");
    }

    // End-to-end proof of the Phase-2 pipeline MINUS the ffmpeg mic capture:
    // frame a real speech WAV exactly as the live loop does, run it through the
    // Segmenter, decode the closed utterance with the real offline recognizer,
    // and assert the French transcript. Self-skips unless the model is on disk
    // (so the default `cargo test` isn't environment-coupled). The only piece
    // this does NOT cover is the live mic, which needs a human speaking.
    #[test]
    fn segments_and_decodes_a_real_wav() {
        let dir = crate::senses::stt::resolve_model_dir();
        let wav = format!("{dir}/test_wavs/fr.wav");
        if !std::path::Path::new(&wav).exists() {
            eprintln!("skip: model/sample absent at {wav}");
            return;
        }
        let (samples, rate) = crate::senses::audio::read_wav_mono(&wav).expect("read fr.wav");
        if rate != SAMPLE_RATE {
            eprintln!("skip: fr.wav is {rate} Hz, segmenter assumes {SAMPLE_RATE}");
            return;
        }
        let n = frame_samples();
        // Use the SHIPPED runtime default, not a hand-tuned value — this test must
        // prove the daemon's real config segments real speech, or it proves nothing.
        let mut seg = Segmenter::new(DEFAULT_MIC_THRESHOLD, FRAME_MS, DEFAULT_MIC_ENDPOINT_MS);
        let mut utts: Vec<Vec<i16>> = Vec::new();
        for frame in samples.chunks(n) {
            if let Some(u) = seg.push(frame) {
                utts.push(u);
            }
        }
        if let Some(u) = seg.flush() {
            utts.push(u);
        }
        assert!(!utts.is_empty(), "the segmenter should carve at least one utterance from real speech");
        let mut stt = crate::senses::stt::Stt::load(&dir).expect("load recognizer");
        let joined = utts.iter().map(|u| stt.transcribe_pcm(SAMPLE_RATE, u)).collect::<Vec<_>>().join(" ");
        eprintln!("segmented+decoded: {joined}");
        let lower = joined.to_lowercase();
        assert!(lower.contains("pays") && lower.contains("demand"), "expected the JFK French line, got: {joined}");
    }

    #[test]
    fn two_utterances_are_segmented_separately() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 15));
        stream.extend(frames_of(0, 8)); // close #1
        stream.extend(frames_of(12_000, 15));
        stream.extend(frames_of(0, 8)); // close #2
        for f in &stream {
            if seg.push(f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 2);
    }
}
