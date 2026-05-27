// Broad "browser use" validation through the real BrowserTool LLM surface (headless chromium):
// navigate, get_title/get_url, assert_text, snapshot+find_elements, fill (batch), select, click,
// extract (structured), screenshot, evaluate, link-nav + go_back, and a best-effort real-site check.
// Run: npx tsx scratch/browser-use-probe2.ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { getBrowserManager } from '../src/browser-automation/browser-manager.js';
import { BrowserTool } from '../src/browser-automation/browser-tool.js';

getBrowserManager({ headless: true }); // prime the singleton headless before BrowserTool constructs
const tool = new BrowserTool();
const p1 = pathToFileURL(path.join(process.cwd(), 'scratch', 'browser-fixture.html')).href;

const results: Array<{ step: string; success: boolean; info: string }> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(step: string, input: any): Promise<any> {
  const r = await tool.execute(input);
  const info = String(r.output ?? r.error ?? '').replace(/\s+/g, ' ').slice(0, 110);
  results.push({ step, success: r.success, info });
  console.log(`[${r.success ? 'ok' : 'fail'}] ${step}: ${info}`);
  return r;
}

try {
  await run('launch', { action: 'launch' });
  await run('navigate page1', { action: 'navigate', url: p1 });
  await run('get_title', { action: 'get_title' });
  await run('get_url', { action: 'get_url' });
  await run('assert_text title', { action: 'assert_text', text: 'CodeBuddy Browser Fixture' });

  await run('snapshot', { action: 'snapshot', interactiveOnly: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fe = await tool.execute({ action: 'find_elements' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const els: any[] = (fe.data as any)?.elements ?? [];
  const pick = (re: RegExp) => els.find((e) => e.interactive && re.test(e.name || '')) ?? els.find((e) => re.test(e.name || ''));
  const msg = pick(/message/i);
  const country = els.find((e) => e.interactive && (e.role === 'combobox' || /country/i.test(e.name || '')));
  const apply = pick(/apply/i);
  const link = pick(/go to page 2/i);
  console.log('refs:', JSON.stringify({ msg: msg?.ref, country: country?.ref, apply: apply?.ref, link: link?.ref }));

  if (msg) await run('fill (batch)', { action: 'fill', fields: { [String(msg.ref)]: 'Batch fill text' } });
  if (country) await run('select Japan', { action: 'select', ref: country.ref, value: 'Japan' });
  if (apply) await run('click apply', { action: 'click', ref: apply.ref });
  await run('assert saved state', { action: 'assert_text', text: 'Saved: msg=Batch fill text companion=false country=Japan' });

  await run('extract (structured)', { action: 'extract', query: 'country' });
  await run('screenshot', { action: 'screenshot' });
  await run('evaluate document.title', { action: 'evaluate', expression: 'document.title' });

  if (link) await run('click link -> page2', { action: 'click', ref: link.ref });
  await new Promise((r) => setTimeout(r, 600));
  await run('assert page2 loaded', { action: 'assert_text', text: 'Page Two Loaded' });
  await run('go_back', { action: 'go_back' });
  await new Promise((r) => setTimeout(r, 600));
  await run('assert back on page1', { action: 'assert_text', text: 'CodeBuddy Browser Fixture' });

  // Part B — real site over the network (best-effort: tolerate offline).
  try {
    await run('navigate example.com', { action: 'navigate', url: 'https://example.com' });
    await run('get_title example', { action: 'get_title' });
    await run('assert Example Domain', { action: 'assert_text', text: 'Example Domain' });
  } catch (e) {
    results.push({ step: 'real-site', success: false, info: 'network error: ' + String(e).slice(0, 80) });
    console.log('[skip] real-site (network):', String(e).slice(0, 80));
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).map((r) => r.step),
    results,
  };
  console.log('--- BROWSER USE (broad) SUMMARY ---');
  console.log(JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(process.cwd(), 'scratch', 'browser-use-probe2-result.json'), JSON.stringify(summary, null, 2), 'utf8');
} catch (err) {
  console.error('probe2 error:', err);
} finally {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await tool.execute({ action: 'close' } as any);
}
