//! Code Buddy heavy-processing daemon (`codebuddy-captured`).
//!
//! Newline-delimited JSON-RPC over stdin/stdout (same shape as codebuddy-sidecar):
//!   Request:  {"id": 1, "method": "phash", "params": {"path": "/tmp/f.png"}}
//!   Response: {"id": 1, "result": {...}} | {"id": 1, "error": "..."}
//!
//! Offloads the frequent, CPU-bound per-frame work of the Node screen-watcher:
//!   - `phash {path}`        → perceptual hash (robust to lossy re-encode, unlike sha1)
//!   - `diff {a,b}`          → Hamming distance + `similar` between two frames
//!   - `diff {a, hashB}`     → compare a frame against a previously-computed hash
//!   - `ping`                → liveness/version
//!
//! Built on the mature `image` + `image_hasher` crates — no whisper-rs, so it
//! builds without cmake/clang.

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

const HASH_SIDE: u32 = 16;
const SIMILAR_DIST: u32 = 8; // gradient-hash Hamming distance treated as "no real change"

fn hasher() -> image_hasher::Hasher {
    image_hasher::HasherConfig::new()
        .hash_size(HASH_SIDE, HASH_SIDE)
        .hash_alg(image_hasher::HashAlg::Gradient)
        .to_hasher()
}

fn phash(path: &str) -> Result<String, String> {
    let img = image::open(path).map_err(|e| format!("open {path}: {e}"))?;
    Ok(hasher().hash_image(&img).to_base64())
}

fn diff(params: &serde_json::Value) -> Result<serde_json::Value, String> {
    let a = params["a"].as_str().ok_or("a (path) required")?;
    let ha = hasher().hash_image(&image::open(a).map_err(|e| format!("open {a}: {e}"))?);
    // Compare against either a second image path (b) or a precomputed hash (hashB).
    let hb = if let Some(b) = params["b"].as_str() {
        hasher().hash_image(&image::open(b).map_err(|e| format!("open {b}: {e}"))?)
    } else if let Some(hb64) = params["hashB"].as_str() {
        image_hasher::ImageHash::<Box<[u8]>>::from_base64(hb64).map_err(|_| "invalid hashB".to_string())?
    } else {
        return Err("diff needs `b` (path) or `hashB` (base64 hash)".into());
    };
    let dist = ha.dist(&hb);
    Ok(serde_json::json!({
        "hashA": ha.to_base64(),
        "distance": dist,
        "similar": dist <= SIMILAR_DIST,
    }))
}

fn handle(method: &str, params: &serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "ping" => Ok(serde_json::json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })),
        "phash" => {
            let path = params["path"].as_str().ok_or("path required")?;
            Ok(serde_json::json!({ "hash": phash(path)? }))
        }
        "diff" => diff(params),
        other => Err(format!("unknown method: {other}")),
    }
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<Request>(&line) {
            Ok(req) => match handle(&req.method, &req.params) {
                Ok(result) => Response { id: req.id, result: Some(result), error: None },
                Err(error) => Response { id: req.id, result: None, error: Some(error) },
            },
            Err(e) => Response { id: 0, result: None, error: Some(format!("parse: {e}")) },
        };
        if writeln!(out, "{}", serde_json::to_string(&resp).unwrap_or_default()).is_err() {
            break;
        }
        let _ = out.flush();
    }
}
