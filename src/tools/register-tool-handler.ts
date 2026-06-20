/**
 * register_tool — lets Code Buddy author a NEW tool for itself at runtime.
 *
 * This is the "the code it builds can call its own tools" capability. On a
 * passing safety gate it writes BOTH tool registries:
 *   - FormalToolRegistry  → the authored tool is immediately CALLABLE (dispatch),
 *   - legacy ToolRegistry → the authored tool's schema becomes VISIBLE to the
 *     model on the next turn (when the per-turn tool selection rebuilds).
 *
 * Authored tools are namespaced `authored__<name>` (never shadow a built-in) and
 * run SANDBOXED (throwaway cwd, RPC off) when invoked. Gated overall by
 * `CODEBUDDY_SELF_IMPROVE=true` at the registration site (see codebuddy/tools.ts).
 *
 * Safety (Phase 1): dangerous-pattern scan + a hard "no writing under src/"
 * invariant. The fuller empirical gate (held-out behavioral scoring, secret
 * scan, CodeGuardian) lives in the self-improvement engine (Phase 2).
 */

import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ITool, ToolSchema } from './registry/types.js';
import type { ToolResult } from '../types/index.js';
import type { CodeBuddyTool } from '../codebuddy/client.js';
import type { ToolMetadata } from './types.js';
import { FormalToolRegistry } from './registry/tool-registry.js';
import { getToolRegistry } from './registry.js';
import { executeCode, type ExecuteCodeLanguage } from './execute-code-runner.js';
import { matchAllDangerousPatterns } from '../security/dangerous-patterns.js';
import { logger } from '../utils/logger.js';

const AUTHORED_PREFIX = 'authored__';
const ALLOWED_LANGUAGES: ExecuteCodeLanguage[] = ['javascript', 'typescript', 'python'];

function sanitizeName(raw: string): string {
  const base = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base.startsWith(AUTHORED_PREFIX) ? base : `${AUTHORED_PREFIX}${base || 'tool'}`;
}

/** Build an ITool that runs the authored `code` sandboxed when invoked. */
function buildAuthoredTool(opts: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  language: ExecuteCodeLanguage;
  code: string;
}): ITool {
  const { name, description, parameters, language, code } = opts;
  return {
    name,
    description,
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      // Run authored code in a throwaway sandbox dir, RPC off; args arrive as
      // JSON in CODEBUDDY_TOOL_INPUT; the script prints its result to stdout.
      const rootDir = path.join(os.tmpdir(), `cb-authored-${randomUUID()}`);
      try {
        const res = await executeCode(
          { code, language, env: { CODEBUDDY_TOOL_INPUT: JSON.stringify(input ?? {}) } },
          { rootDir, rpcEnabled: false },
        );
        if (!res.ok) {
          return {
            success: false,
            error: `authored tool "${name}" failed (exit ${res.exitCode}): ${
              res.stderr.slice(0, 2000) || res.error || 'no output'
            }`,
          };
        }
        return { success: true, output: res.stdout.slice(0, 100_000) || '(no stdout)' };
      } catch (err) {
        return {
          success: false,
          error: `authored tool "${name}" error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
    getSchema(): ToolSchema {
      return { name, description, parameters: parameters as unknown as ToolSchema['parameters'] };
    },
  };
}

export class RegisterToolTool implements ITool {
  readonly name = 'register_tool';
  readonly description =
    'Author a NEW tool for yourself at runtime. Provide a name, description, JSON-schema params, ' +
    'a language (javascript|typescript|python) and the code. The code reads its call arguments as ' +
    'JSON from the CODEBUDDY_TOOL_INPUT env var and prints its result to stdout. On a passing safety ' +
    'check the tool is registered as `authored__<name>` and becomes callable by you on your next turn.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const rawName = String(input.name ?? '').trim();
    const description = String(input.description ?? '').trim();
    const language = String(input.language ?? 'javascript').toLowerCase() as ExecuteCodeLanguage;
    const code = typeof input.code === 'string' ? input.code : '';
    const parameters =
      input.params && typeof input.params === 'object'
        ? (input.params as Record<string, unknown>)
        : { type: 'object', properties: {} };

    if (!rawName) return { success: false, error: 'register_tool: `name` is required.' };
    if (!description) return { success: false, error: 'register_tool: `description` is required.' };
    if (!code.trim()) return { success: false, error: 'register_tool: `code` is required.' };
    if (!ALLOWED_LANGUAGES.includes(language)) {
      return { success: false, error: `register_tool: language must be one of ${ALLOWED_LANGUAGES.join(', ')}.` };
    }

    // Safety gate (Phase 1): dangerous-pattern scan + hard no-src/-write invariant.
    const dangerous = matchAllDangerousPatterns(code, 'code');
    if (dangerous.length > 0) {
      return {
        success: false,
        error: `register_tool: refused — authored code matched ${dangerous.length} dangerous pattern(s) (${dangerous
          .map((d) => d.description)
          .slice(0, 4)
          .join('; ')}).`,
      };
    }
    if (/src\//.test(code) && /(writeFile|writeFileSync|fs\.\w*write|open\s*\([^)]*['"]w)/i.test(code)) {
      return {
        success: false,
        error: 'register_tool: refused — authored tools may not write under src/ (hard self-modification invariant).',
      };
    }

    const name = sanitizeName(rawName);
    const authored = buildAuthoredTool({ name, description, parameters, language, code });

    // Dual-registry write: FormalToolRegistry (callable now) + legacy ToolRegistry
    // (schema visible to the model on the next turn's tool-selection rebuild).
    try {
      FormalToolRegistry.getInstance().register(authored, { override: true });
      const definition: CodeBuddyTool = {
        type: 'function',
        function: { name, description, parameters: parameters as unknown as CodeBuddyTool['function']['parameters'] },
      };
      const metadata: ToolMetadata = {
        name,
        category: 'system',
        keywords: ['authored', 'self-extension', 'tool'],
        priority: 5,
        description,
      };
      getToolRegistry().registerTool(definition, metadata);
    } catch (err) {
      return {
        success: false,
        error: `register_tool: registration failed — ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    logger.info(`[self-improve] authored tool registered: ${name}`);
    return {
      success: true,
      output:
        `Registered tool \`${name}\`. It is now callable by you on your next turn — ` +
        `call it with arguments matching its params.`,
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name (namespaced to authored__<name>)' },
          description: { type: 'string', description: 'What the tool does and when to use it' },
          params: { type: 'object', description: 'JSON Schema for the tool arguments' },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python'],
            description: 'Implementation language (default javascript)',
          },
          code: {
            type: 'string',
            description: 'Code that reads its args as JSON from env CODEBUDDY_TOOL_INPUT and prints its result to stdout',
          },
        },
        required: ['name', 'description', 'code'],
      },
    };
  }
}

export function createRegisterToolTool(): RegisterToolTool {
  return new RegisterToolTool();
}
