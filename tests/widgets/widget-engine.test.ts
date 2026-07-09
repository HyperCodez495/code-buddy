/**
 * Widget engine — the self-learning loop: curated hit, opt-in generation, gate,
 * keep, reuse, and bounded generation (timeout / in-flight dedup / cooldown).
 * Isolated temp authored dir; LLM propose step is injected. Each test uses a
 * DISTINCT kind so the module-level in-flight/cooldown maps never cross tests.
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveOrGenerate,
  keepAuthoredWidget,
  listAuthoredWidgets,
  readAuthoredTemplate,
} from '../../src/widgets/widget-engine.js';
import type { WidgetProposal } from '../../src/widgets/widget-types.js';

function tmpEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wdg-eng-'));
  return { CODEBUDDY_WIDGETS_DIR: dir, ...extra } as NodeJS.ProcessEnv;
}

// 'crypto' family = kinds that are NOT curated (weather/news/stock ARE), so they
// exercise the generation path.
const tpl = (cls: string) => `<style>.cbw-${cls}{padding:8px}</style><div class="cbw-${cls}">{{ symbol }} {{ price }}</div>`;

describe('resolveOrGenerate', () => {
  it('renders a curated widget immediately (no generation needed)', async () => {
    const env = tmpEnv(); // generation OFF, but curated always works
    const doc = await resolveOrGenerate(
      { type: 'weather', location: 'Paris', current: { temperature: 20, condition: 'clair' } },
      { env }
    );
    expect(doc).toContain('Paris');
    expect(doc).toContain('<!doctype html>');
  });

  it('returns null for an unknown kind when generation is OFF (opt-in)', async () => {
    const env = tmpEnv(); // CODEBUDDY_WIDGETS unset
    const propose = jest.fn();
    const doc = await resolveOrGenerate({ type: 'cryptooff', symbol: 'BTC', price: 9 }, { env, propose });
    expect(doc).toBeNull();
    expect(propose).not.toHaveBeenCalled();
  });

  it('generates, gates, keeps and RENDERS a new widget when enabled; reuses next time', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const propose = jest.fn(
      async (kind: string, sample: unknown): Promise<WidgetProposal> => ({ kind, template: tpl('cryptogen'), sample })
    );
    const doc = await resolveOrGenerate({ type: 'cryptogen', symbol: 'ACME', price: 42 }, { env, propose });
    expect(doc).toContain('ACME 42');
    expect(listAuthoredWidgets(env)).toContain('cryptogen');
    expect(readAuthoredTemplate('cryptogen', env)).toBe(tpl('cryptogen'));

    // Second call is a registry hit → propose NOT called again.
    propose.mockClear();
    const doc2 = await resolveOrGenerate({ type: 'cryptogen', symbol: 'BETA', price: 7 }, { env, propose });
    expect(doc2).toContain('BETA 7');
    expect(propose).not.toHaveBeenCalled();
  });

  it('rejects an unsafe proposal and keeps NOTHING', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const propose = async (kind: string, sample: unknown): Promise<WidgetProposal> => ({
      kind,
      template: '<div class="cbw-cryptobad"><script>fetch("//evil")</script>{{ symbol }}</div>',
      sample,
    });
    const doc = await resolveOrGenerate({ type: 'cryptobad', symbol: 'X', price: 1 }, { env, propose });
    expect(doc).toBeNull();
    expect(listAuthoredWidgets(env)).not.toContain('cryptobad');
  });

  it('never-throws when the proposer returns null', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const doc = await resolveOrGenerate({ type: 'cryptonull', symbol: 'X', price: 1 }, { env, propose: async () => null });
    expect(doc).toBeNull();
  });

  it('times out a slow proposer (fallback null) instead of freezing the render path', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_GEN_TIMEOUT_MS: '40' });
    const propose = jest.fn(() => new Promise<WidgetProposal>(() => {})); // never resolves
    const doc = await resolveOrGenerate({ type: 'cryptoslow', symbol: 'X', price: 1 }, { env, propose });
    expect(doc).toBeNull();
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it('dedups concurrent generation of the same kind (one propose)', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    let calls = 0;
    const propose = async (kind: string, sample: unknown): Promise<WidgetProposal> => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { kind, template: tpl('cryptorace'), sample };
    };
    const data = { type: 'cryptorace', symbol: 'ACME', price: 42 };
    const [a, b] = await Promise.all([
      resolveOrGenerate(data, { env, propose }),
      resolveOrGenerate(data, { env, propose }),
    ]);
    expect(a).toContain('ACME 42');
    expect(b).toContain('ACME 42');
    expect(calls).toBe(1); // second caller shared the in-flight generation
  });

  it('backs off after a failure (cooldown) — does not re-hit the proposer', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_GEN_COOLDOWN_MS: '100000' });
    const propose = jest.fn(async () => null);
    const data = { type: 'cryptocool', symbol: 'X', price: 1 };
    expect(await resolveOrGenerate(data, { env, propose })).toBeNull(); // fails, sets cooldown
    expect(await resolveOrGenerate(data, { env, propose })).toBeNull(); // within cooldown → skipped
    expect(propose).toHaveBeenCalledTimes(1);
  });
});

describe('keepAuthoredWidget', () => {
  it('writes widget.html + meta.json', () => {
    const env = tmpEnv();
    expect(keepAuthoredWidget({ kind: 'cryptokeep', template: tpl('cryptokeep'), sample: {} }, env)).toBe(true);
    const dir = join(env.CODEBUDDY_WIDGETS_DIR!, 'authored-cryptokeep');
    expect(existsSync(join(dir, 'widget.html'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).source).toBe('authored');
  });

  it('refuses to shadow a curated widget', () => {
    const env = tmpEnv();
    expect(keepAuthoredWidget({ kind: 'weather', template: '<div>evil</div>', sample: {} }, env)).toBe(false);
    expect(listAuthoredWidgets(env)).not.toContain('weather');
  });
});
