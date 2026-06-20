//! UI sense — semantic desktop events (active app / window / focus) via the
//! Linux accessibility bus (AT-SPI). The permissive, Linux-native, clean-room
//! equivalent of the ui-events idea (whose own Linux listener is an unimplemented
//! stub): inspired by its event schema, written with the MIT/Apache `atspi` crate
//! — no copied code. Emits `Ui/*` events; live capture is behind `live-ui`.

// The mapper + schema are used by tests + the live feature, not the default binary.
#![allow(dead_code)]

use crate::event::{Modality, SensoryEvent};

const UI_SALIENCE: u8 = 90; // UI context — above the heartbeat, below speech/motion

/// A normalized UI signal (our schema, inspired by ui-events), decoupled from the
/// AT-SPI event types so the mapping is pure + testable headless.
pub enum UiSignal {
    AppFocus { app: String },
    WindowTitle { title: String },
    ElementFocus { name: String },
}

pub fn map_signal(sig: &UiSignal) -> SensoryEvent {
    let (kind, payload) = match sig {
        UiSignal::AppFocus { app } => ("app_focus", serde_json::json!({ "app": app })),
        UiSignal::WindowTitle { title } => ("window_title", serde_json::json!({ "title": title })),
        UiSignal::ElementFocus { name } => ("element_focus", serde_json::json!({ "name": name })),
    };
    SensoryEvent::new(Modality::Ui, kind, UI_SALIENCE, payload)
}

#[cfg(feature = "live-ui")]
pub mod live {
    use super::*;
    use atspi::events::object::StateChangedEvent;
    use atspi::events::ObjectEvents;
    use tokio::sync::mpsc;
    use tokio_stream::StreamExt;

    /// Stream AT-SPI focus events → `Ui/element_focus` into the thalamus. Connects
    /// to the running a11y bus; never panics (logs + returns on failure).
    pub async fn run(tx: mpsc::Sender<SensoryEvent>) {
        let atspi = match atspi::AccessibilityConnection::new().await {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[buddy-sense] atspi connect failed: {e}");
                return;
            }
        };
        if let Err(e) = atspi.register_event::<ObjectEvents>().await {
            eprintln!("[buddy-sense] atspi register failed: {e}");
            return;
        }
        let events = atspi.event_stream();
        tokio::pin!(events);
        while let Some(Ok(ev)) = events.next().await {
            let Ok(change) = StateChangedEvent::try_from(ev) else {
                continue;
            };
            if change.state == "focused".into() && change.enabled {
                let name = change.item.name().map(|n| n.to_string()).unwrap_or_default();
                if tx.send(map_signal(&UiSignal::ElementFocus { name })).await.is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_app_focus() {
        let ev = map_signal(&UiSignal::AppFocus { app: "Code".into() });
        assert_eq!(ev.modality, Modality::Ui);
        assert_eq!(ev.kind, "app_focus");
        assert_eq!(ev.payload["app"], "Code");
        assert_eq!(ev.salience, UI_SALIENCE);
    }

    #[test]
    fn maps_window_title_and_element_focus() {
        assert_eq!(map_signal(&UiSignal::WindowTitle { title: "main.rs".into() }).kind, "window_title");
        let ef = map_signal(&UiSignal::ElementFocus { name: "button".into() });
        assert_eq!(ef.kind, "element_focus");
        assert_eq!(ef.payload["name"], "button");
    }
}
