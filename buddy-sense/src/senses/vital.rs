//! Vital sense — the autonomic heartbeat. Like a real heartbeat, it beats
//! continuously and in PARALLEL with the other senses, independent of what is
//! seen or heard. Each beat carries vital signs (uptime, load) and is low
//! salience (routine rhythm — the thalamus keeps it but never escalates it).

use tokio::sync::mpsc;

use crate::event::{now_ms, Modality, SensoryEvent};

/// Routine autonomic rhythm → low salience (never escalated by the thalamus).
pub const HEARTBEAT_SALIENCE: u8 = 5;

/// 1-minute load average from /proc/loadavg (Linux); None elsewhere / on error.
fn load1() -> Option<f64> {
    std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().next().map(str::to_string))
        .and_then(|s| s.parse::<f64>().ok())
}

/// Build one heartbeat event (pure; the run loop just stamps + sends these).
pub fn heartbeat_event(beat: u64, uptime_ms: u64, interval_ms: u64) -> SensoryEvent {
    SensoryEvent::new(
        Modality::Vital,
        "heartbeat",
        HEARTBEAT_SALIENCE,
        serde_json::json!({
            "beat": beat,
            "uptime_ms": uptime_ms,
            "load1": load1(),
            "interval_ms": interval_ms,
        }),
    )
}

/// Run the heartbeat forever (until the thalamus channel closes), emitting a beat
/// every `interval_ms`. Spawn it alongside the other senses.
pub async fn run(tx: mpsc::Sender<SensoryEvent>, interval_ms: u64) {
    let started = now_ms();
    let mut beat: u64 = 0;
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(interval_ms.max(1)));
    loop {
        ticker.tick().await;
        beat += 1;
        let uptime_ms = now_ms().saturating_sub(started);
        if tx.send(heartbeat_event(beat, uptime_ms, interval_ms)).await.is_err() {
            break; // thalamus gone → stop beating
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_event_is_low_salience_vital_with_beat_count() {
        let e = heartbeat_event(3, 3000, 1000);
        assert_eq!(e.modality, Modality::Vital);
        assert_eq!(e.kind, "heartbeat");
        assert_eq!(e.salience, HEARTBEAT_SALIENCE);
        assert!(e.salience < crate::bus::ESCALATE_SALIENCE); // never escalated
        assert_eq!(e.payload["beat"], 3);
        assert_eq!(e.payload["uptime_ms"], 3000);
    }

    #[tokio::test]
    async fn run_beats_at_the_interval() {
        let (tx, mut rx) = mpsc::channel::<SensoryEvent>(8);
        let handle = tokio::spawn(async move { run(tx, 20).await });
        let first = rx.recv().await.unwrap();
        let second = rx.recv().await.unwrap();
        assert_eq!(first.kind, "heartbeat");
        assert_eq!(first.payload["beat"], 1);
        assert_eq!(second.payload["beat"], 2);
        handle.abort();
    }
}
