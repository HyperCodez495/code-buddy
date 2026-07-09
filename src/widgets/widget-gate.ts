/**
 * Widget gate — validates an LLM-proposed authored widget template. Ordered,
 * blocking, FAIL-CLOSED (anything unproven is rejected; nothing is kept on a
 * miss). Mirrors the self-improvement skill/tool gates.
 *
 *   G1 STATIC FIREWALL — the authored template must be inert & self-contained:
 *      no <script>, no inline event handlers, no `javascript:`, no external
 *      resource loads (src=, external stylesheet, @import, url(http…)), no
 *      <iframe>/<object>/<embed>. (Outbound <a href> links ARE allowed.)
 *   G2 RENDER — `renderTemplate(template, sample)` must produce non-empty output,
 *      leave NO unresolved `{{…}}` tokens, and the rendered HTML must ALSO pass
 *      the firewall (defence in depth; data is escaped so this is belt & braces).
 *
 * Pure & synchronous — no I/O, no network, no code execution.
 *
 * @module widgets/widget-gate
 */
import { renderTemplate } from './template-engine.js';
import type { WidgetProposal, WidgetGateOutcome } from './widget-types.js';

/** Patterns that make a widget unsafe (loads/executes code or phones home). */
const FIREWALL_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /<\s*script\b/i, why: 'inline <script> (CSP-blocked and unsafe)' },
  { re: /<\s*(iframe|object|embed|frame|frameset)\b/i, why: 'nested framing/embedding element' },
  { re: /\son[a-z]+\s*=/i, why: 'inline event handler (onload/onclick/…)' },
  { re: /javascript\s*:/i, why: 'javascript: URL' },
  { re: /\bdata\s*:\s*text\/html/i, why: 'data:text/html payload' },
  { re: /<\s*link\b[^>]*\bhref\s*=\s*["']?\s*https?:/i, why: 'external stylesheet <link>' },
  { re: /@import\b/i, why: '@import (external stylesheet load)' },
  { re: /\burl\s*\(\s*["']?\s*(https?:)?\/\//i, why: 'url() loading an external resource' },
  // A resource-loading `src=` to an external/absolute URL. Escaped `{{ }}` is fine.
  { re: /\bsrc\s*=\s*["']?\s*(https?:)?\/\//i, why: 'external resource via src=' },
  { re: /<\s*(base|meta)\b/i, why: '<base>/<meta> (can redirect resource resolution)' },
];

/** Scan a chunk of HTML for firewall violations. Returns the list of reasons (empty = safe). */
export function scanWidgetFirewall(html: string): string[] {
  const reasons: string[] = [];
  for (const { re, why } of FIREWALL_PATTERNS) {
    if (re.test(html)) reasons.push(why);
  }
  return reasons;
}

/**
 * True when the template has ≥1 PLAIN data interpolation `{{ path }}` (not a
 * block tag `{{#each}}`/`{{#if}}`/`{{/…}}`/`{{else}}`). A template with none is
 * hardcoded by construction — it cannot reflect the data.
 */
export function hasDataBinding(template: string): boolean {
  const tags = template.match(/\{\{\{?\s*([^}]*?)\s*\}?\}\}/g) ?? [];
  return tags.some((t) => {
    const inner = t.replace(/^\{\{\{?\s*|\s*\}?\}\}$/g, '').trim();
    return inner.length > 0 && !inner.startsWith('#') && !inner.startsWith('/') && inner !== 'else';
  });
}

/**
 * Derive a DIVERGENT sample from the visible one: every scalar leaf is replaced
 * by a value guaranteed to differ, arrays gain one extra element. The proposer
 * never sees this (it is computed at gate-time) — the widget analogue of the
 * tools' hidden held-out cases. A template that hardcodes the visible values
 * renders IDENTICALLY for both samples ⇒ caught. Pure, never throws.
 */
export function deriveDivergentSample(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value + 987654 : 123456;
  if (typeof value === 'string') return value + '_CBW_HELDOUT';
  if (typeof value === 'boolean') return !value;
  if (value === null || value === undefined) return 'CBW_HELDOUT';
  if (Array.isArray(value)) {
    const mapped = value.map((v) => deriveDivergentSample(v));
    // Change the length too, so count/list-only widgets also diverge.
    if (mapped.length > 0) mapped.push(deriveDivergentSample(value[0]));
    return mapped;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deriveDivergentSample(v);
    }
    return out;
  }
  return value;
}

/** Run a proposal through the gate. Fail-closed. Pure. */
export function gateWidget(proposal: WidgetProposal): WidgetGateOutcome {
  const template = (proposal?.template ?? '').trim();
  if (!template) {
    return { accepted: false, reason: 'render-empty', reasons: ['empty template'] };
  }

  // G1 — firewall on the raw template.
  const staticReasons = scanWidgetFirewall(template);
  if (staticReasons.length > 0) {
    return { accepted: false, reason: 'static-scan', reasons: staticReasons };
  }

  // G2 — render with the sample and re-check.
  let fragment: string;
  try {
    fragment = renderTemplate(template, proposal.sample);
  } catch (e) {
    return { accepted: false, reason: 'render-empty', reasons: [`render threw: ${String(e)}`] };
  }
  if (!fragment.trim()) {
    return { accepted: false, reason: 'render-empty', reasons: ['template rendered to empty output'] };
  }
  if (/\{\{.*?\}\}/.test(fragment)) {
    return {
      accepted: false,
      reason: 'unrendered-tokens',
      reasons: ['rendered output still contains unresolved {{…}} tokens'],
    };
  }
  const renderedReasons = scanWidgetFirewall(fragment);
  if (renderedReasons.length > 0) {
    return { accepted: false, reason: 'render-unsafe', reasons: renderedReasons };
  }

  // Anti-hardcoding (the widget analogue of the tools' held-out check). A widget
  // must be a FUNCTION of its data, else it shows stale values on reuse.
  if (!hasDataBinding(template)) {
    return {
      accepted: false,
      reason: 'no-data-binding',
      reasons: ['template has no {{ }} data interpolation — it cannot reflect the data'],
    };
  }
  let divergent: string;
  try {
    divergent = renderTemplate(template, deriveDivergentSample(proposal.sample));
  } catch {
    divergent = fragment; // a template that breaks on divergent data is not trustworthy
  }
  if (divergent === fragment) {
    return {
      accepted: false,
      reason: 'hardcoded',
      reasons: ['identical output for divergent data — the template hardcodes values instead of using them'],
    };
  }

  return { accepted: true, fragment };
}
