/**
 * Verify Tool Definition
 *
 * OpenAI function-calling schema for the `verify` tool — explicit delegation
 * to the independent, fresh-context Verifier agent (Manus doctrine: "delegate
 * to the verifier"). The Verifier reproduces the work and runs REAL oracles
 * (app_server / web_test / the test suite / a real API request), then hands
 * back a CONFIRMED / NEEDS REVIEW verdict backed by evidence. It is read-only
 * (writes are refused fail-closed), so it can be trusted to check work without
 * changing it.
 */

import type { CodeBuddyTool } from './types.js';

export const VERIFY_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'verify',
    description:
      'Delegate to an INDEPENDENT fresh-context Verifier that establishes whether a piece of work ACTUALLY WORKS — it reproduces the change and runs real oracles (starts the dev server + web_test, runs the real test suite, or makes a real API request), then returns a structured CONFIRMED / NEEDS REVIEW verdict backed by raw evidence. ' +
      'The Verifier is READ-ONLY (it reads, searches, runs tests and drives the app but never edits/writes/patches files). ' +
      'Call it BEFORE declaring a non-trivial task done, to get evidence instead of asserting success. Inherits none of your assumptions.',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description:
            'What to verify — describe the change/flow and the claim to prove (e.g. "the login form submits and redirects to /dashboard", "the failing test tests/foo.test.ts now passes").',
        },
        url: {
          type: 'string',
          description:
            'Optional URL to drive when verifying a running web UI (passed through to the Verifier as a hint).',
        },
      },
      required: ['instruction'],
    },
  },
};

export const VERIFY_TOOLS: CodeBuddyTool[] = [VERIFY_TOOL];
