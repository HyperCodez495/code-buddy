//! Bridge — ships admitted events as JSON over a WebSocket to Code Buddy's
//! sensory bridge, which re-emits them onto its internal event bus. Reconnects
//! on failure; never panics.

use futures_util::SinkExt;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::event::SensoryEvent;

pub async fn run_bridge(url: String, mut rx: broadcast::Receiver<SensoryEvent>) {
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                eprintln!("[buddy-sense] bridge connected → {url}");
                loop {
                    match rx.recv().await {
                        Ok(ev) => {
                            if let Ok(text) = serde_json::to_string(&ev) {
                                if ws.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        // Lagged: we dropped some events under load — keep going.
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            eprintln!("[buddy-sense] bridge lagged, dropped {n} events");
                        }
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
            Err(e) => eprintln!("[buddy-sense] bridge connect failed: {e}; retrying in 2s"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}
