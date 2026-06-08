import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { CapturedBridge } from '../../src/capture/captured-bridge.js';

// A real, committed PNG (valid — the image crate validates CRCs strictly).
const REAL_PNG = join(process.cwd(), 'cowork', 'public', 'logo.png');

const bridge = new CapturedBridge();
const available = bridge.isAvailable() && existsSync(REAL_PNG); // daemon built + fixture present

describe('CapturedBridge', () => {
  it('findBinary / isAvailable resolve without throwing', () => {
    expect(typeof bridge.isAvailable()).toBe('boolean');
    expect(bridge.findBinary() === null || typeof bridge.findBinary() === 'string').toBe(true);
  });

  it.skipIf(!available)('phash + diff round-trip via the real Rust daemon', async () => {
    const f = REAL_PNG;
    try {
      const pong = await bridge.ping();
      expect(pong.ok).toBe(true);

      const hash = await bridge.phash(f);
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);

      const d = await bridge.diff(f, { b: f });
      expect(d.distance).toBe(0);
      expect(d.similar).toBe(true);

      // diff against the precomputed hash works too.
      const d2 = await bridge.diff(f, { hashB: hash });
      expect(d2.distance).toBe(0);
    } finally {
      bridge.stop();
    }
  });
});
