//! Senses — parallel perception sources. Each emits SensoryEvents into the
//! thalamus over a bounded channel. Audio + the autonomic vital heartbeat ship;
//! video follows.

pub mod audio;
pub mod vital;
