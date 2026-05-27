// Real-browser validation ("browser use"): launch headless chromium, navigate to a local HTML
// fixture, snapshot (injects data-agent-ref), then type/click/select BY REF — exercising the
// uncommitted selector-first (data-agent-ref) click/type paths + stealth. Assert via getContent().
// Run: npx tsx scratch/browser-use-probe.ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { BrowserManager } from '../src/browser-automation/browser-manager.js';

const fixtureUrl = pathToFileURL(path.join(process.cwd(), 'scratch', 'browser-fixture.html')).href;

const mgr = new BrowserManager({ headless: true });
try {
  await mgr.launch();
  await mgr.navigate({ url: fixtureUrl });

  const snap = await mgr.takeSnapshot({ interactiveOnly: false });
  const els = snap.elements;
  console.log(`snapshot: ${els.length} elements @ ${snap.url}`);
  for (const e of els) console.log(`  [${e.ref}] ${e.role} interactive=${e.interactive} name="${e.name}"`);

  // Prefer an interactive element when matching by name (avoids picking a <p>/<label> with same text).
  const pick = (re: RegExp) =>
    els.find((e) => e.interactive && re.test(e.name || '')) ?? els.find((e) => re.test(e.name || ''));
  const msg = pick(/message/i);
  const companion = pick(/companion/i);
  const country = els.find((e) => e.interactive && (/country/i.test(e.name || '') || e.role === 'combobox'));
  const apply = pick(/apply/i);
  const refs = { msg: msg?.ref, companion: companion?.ref, country: country?.ref, apply: apply?.ref };
  console.log('resolved refs:', JSON.stringify(refs));

  const stepsRun: Record<string, boolean> = {};
  if (msg) { await mgr.type(msg.ref, 'Bonjour navigateur', { clear: true }); stepsRun.typeByRef = true; }
  if (companion) { await mgr.click(companion.ref); stepsRun.checkboxClickByRef = true; }
  if (country) { await mgr.select({ ref: country.ref, value: 'France' }); stepsRun.selectByRef = true; }
  if (apply) { await mgr.click(apply.ref); stepsRun.applyClickByRef = true; }

  await new Promise((r) => setTimeout(r, 300));
  const content = await mgr.getContent();
  const expected = 'Saved: msg=Bonjour navigateur companion=true country=France';
  const summary = {
    elements: els.length,
    refs,
    stepsRun,
    expectedStatus: expected,
    statusAchieved: content.includes(expected),
  };
  console.log('--- BROWSER USE SUMMARY ---');
  console.log(JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(process.cwd(), 'scratch', 'browser-use-probe-result.json'), JSON.stringify(summary, null, 2), 'utf8');
} catch (err) {
  console.error('browser probe error:', err);
} finally {
  await mgr.close();
}
