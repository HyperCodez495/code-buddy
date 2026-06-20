/**
 * Short-term sensory memory — a bounded rolling buffer of recent perceptions
 * (the nervous system's working memory). Reactions push every perception here;
 * the dreaming consolidator drains + summarizes it into long-term memory every N
 * heartbeats (like OpenClaw's dreaming: short-term recall → consolidated store).
 *
 * @module sensory/sensory-memory
 */

import type { Perception } from './reactions.js';

export class SensoryMemory {
  private buf: Perception[] = [];

  constructor(private readonly cap = 1000) {}

  push(p: Perception): void {
    this.buf.push(p);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  snapshot(): Perception[] {
    return [...this.buf];
  }

  /** Take everything and clear (consolidation consumes the window). */
  drain(): Perception[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  size(): number {
    return this.buf.length;
  }
}

let singleton: SensoryMemory | undefined;

export function getSensoryMemory(): SensoryMemory {
  if (!singleton) singleton = new SensoryMemory();
  return singleton;
}
