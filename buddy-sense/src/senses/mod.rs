//! Senses — parallel perception sources. Each emits SensoryEvents into the
//! thalamus over a bounded channel. Audio ships first; video/vital follow.

pub mod audio;
