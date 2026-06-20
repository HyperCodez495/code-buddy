//! buddy-sense — a parallel multi-sensory "nervous system" feeding Code Buddy.
//!
//! Senses (parallel) → bounded channel → thalamus (coalesce/prioritize/memory)
//! → broadcast → bridge (WebSocket) → Code Buddy's event bus.
//!
//! Usage:
//!   buddy-sense path/to/audio.wav    # run the audio sense over a WAV (headless)
//!   buddy-sense                      # demo: emit a heartbeat every 2s
//! Env: BUDDY_SENSE_BRIDGE_URL (default ws://127.0.0.1:8129)

mod bridge;
mod bus;
mod event;
mod senses;

use tokio::sync::{broadcast, mpsc};

use event::{Modality, SensoryEvent};

const AUDIO_FRAME_MS: u64 = 20;
const AUDIO_THRESHOLD: f64 = 0.05;

#[tokio::main]
async fn main() {
    let url = std::env::var("BUDDY_SENSE_BRIDGE_URL").unwrap_or_else(|_| "ws://127.0.0.1:8129".to_string());
    let wav = std::env::args().skip(1).find(|a| a.ends_with(".wav"));

    // Sense → thalamus (bounded = backpressure). Thalamus → consumers (broadcast).
    let (sense_tx, sense_rx) = mpsc::channel::<SensoryEvent>(32);
    let (bcast_tx, _keep) = broadcast::channel::<SensoryEvent>(128);

    let thalamus = bus::Thalamus::new(64, 200);
    {
        let tx = bcast_tx.clone();
        tokio::spawn(async move { thalamus.run(sense_rx, tx).await });
    }

    // Bridge to Code Buddy.
    {
        let rx = bcast_tx.subscribe();
        tokio::spawn(async move { bridge::run_bridge(url, rx).await });
    }

    match wav {
        Some(path) => {
            match senses::audio::wav_events(&path, AUDIO_FRAME_MS, AUDIO_THRESHOLD) {
                Ok(events) => {
                    eprintln!("[buddy-sense] audio: {} VAD event(s) from {path}", events.len());
                    for ev in events {
                        if sense_tx.send(ev).await.is_err() {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    }
                }
                Err(e) => eprintln!("[buddy-sense] audio error: {e}"),
            }
            // Let the bridge flush.
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        None => {
            eprintln!("[buddy-sense] demo mode — heartbeat every 2s (pass a .wav for the audio sense)");
            let mut n: u64 = 0;
            loop {
                let ev = SensoryEvent::new(Modality::Vital, "heartbeat", 10, serde_json::json!({ "n": n }));
                if sense_tx.send(ev).await.is_err() {
                    break;
                }
                n += 1;
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
}
