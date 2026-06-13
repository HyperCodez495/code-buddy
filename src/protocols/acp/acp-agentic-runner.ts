/**
 * ACP agentic (tool-using) prompt runner.
 *
 * Implements a bounded tool-using turn for the Zed Agent Client Protocol
 * (https://agentclientprotocol.com). Unlike the original text-only runner,
 * this drives a real agentic loop:
 *
 *   1. Ask the LLM (with a small toolset) for the next step.
 *   2. If it emits tool calls, EXECUTE each one and feed the result back.
 *   3. Repeat until the model stops calling tools (`end_turn`) or we hit
 *      the round cap (`max_turn_requests`).
 *
 * During the loop we surface activity to the editor as spec-grounded ACP
 * `session/update` notifications:
 *   - `tool_call`        — emitted when a tool starts (status `in_progress`).
 *   - `tool_call_update` — emitted with status `completed` / `failed` and the
 *                          tool output as a `content` block.
 *   - `agent_message_chunk` — the model's final assistant text.
 *
 * Capability-aware behaviour (gated by `initialize.clientCapabilities`):
 *   - File READS route through the editor buffer via the client method
 *     `fs/read_text_file` when `clientCapabilities.fs.readTextFile` is
 *     advertised (so the agent sees unsaved edits); otherwise they fall back
 *     to disk, scoped to the session `cwd`.
 *   - Before each file read we ask the client to confirm via
 *     `session/request_permission` when that round-trip is available; a
 *     rejection fails the tool call instead of leaking content.
 *
 * Read-only tools are always exposed (`view_file`, `list_directory`,
 * `search`). `write_file` is exposed only when the editor advertises
 * `fs.writeTextFile`, and the write is routed through the editor permission
 * flow. Cancellation is honoured by checking `signal.aborted` on every loop
 * iteration and after every client round-trip.
 */

import { spawn } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import type {
  AcpContentBlock,
  AcpPromptContext,
  AcpStopReason,
} from './acp-stdio-server.js';
import type {
  CodeBuddyMessage,
  CodeBuddyResponse,
  CodeBuddyTool,
  CodeBuddyToolCall,
} from '../../codebuddy/client.js';

/** The LLM call this runner depends on — matches `CodeBuddyClient.chat`. */
export type AcpChatFn = (
  messages: CodeBuddyMessage[],
  tools?: CodeBuddyTool[],
) => Promise<CodeBuddyResponse>;

export interface AcpAgenticRunnerOptions {
  /** LLM call (inject `client.chat.bind(client)`; tests inject a fake). */
  chat: AcpChatFn;
  /** Max LLM rounds before returning `max_turn_requests`. Default 12. */
  maxRounds?: number;
  /** Max bytes returned by a single read/search before truncation. */
  maxToolOutputBytes?: number;
}

const DEFAULT_MAX_ROUNDS = 12;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const LIST_DIRECTORY_MAX_ENTRIES = 256;
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_MAX_RESULTS = 200;

const SYSTEM_PROMPT =
  'You are Code Buddy, a coding assistant operating over the Agent Client Protocol ' +
  'inside a code editor. Use the tools provided for this turn when you need workspace context. ' +
  'If write_file is not available, never claim to have modified files. If write_file is available, ' +
  'writes are routed through the editor and require client permission. Answer concisely in Markdown.';

const READONLY_TOOLS: CodeBuddyTool[] = [
  {
    type: 'function',
    function: {
      name: 'view_file',
      description: 'Read the full text of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file (absolute, or relative to the workspace).' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List the entries of a directory in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (absolute, or relative to the workspace). Defaults to the workspace root.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the workspace for a text pattern (ripgrep).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The text or regex pattern to search for.' },
          path: { type: 'string', description: 'Directory to search within. Defaults to the workspace root.' },
        },
        required: ['query'],
      },
    },
  },
];

const WRITE_FILE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Write text content to a file through the editor client. Will overwrite existing files after permission.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file (absolute, or relative to the workspace).' },
        content: { type: 'string', description: 'The exact string content to write into the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
};

const TOOL_KIND: Record<string, 'read' | 'search' | 'edit'> = {
  view_file: 'read',
  list_directory: 'read',
  search: 'search',
  write_file: 'edit',
};

interface ToolExecResult {
  output: string;
  isError: boolean;
}

/**
 * Build an injectable ACP prompt runner that performs a bounded,
 * tool-using turn. Returns a function compatible with `AcpPromptRunner`.
 */
export function createAcpAgenticRunner(
  options: AcpAgenticRunnerOptions,
): (ctx: AcpPromptContext) => Promise<{ stopReason: AcpStopReason }> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolOutputBytes = options.maxToolOutputBytes ?? DEFAULT_MAX_TOOL_OUTPUT_BYTES;

  // Cache of MCPClientManager instances per session, so we don't reconnect on every prompt
  const mcpManagers = new Map<string, any>();

  return async function run(ctx: AcpPromptContext): Promise<{ stopReason: AcpStopReason }> {
    const userText = extractPromptText(ctx.prompt);
    if (!userText) {
      return { stopReason: 'end_turn' };
    }

    let mcpManager = mcpManagers.get(ctx.sessionId);
    if (!mcpManager && ctx.mcpServers) {
      try {
        const { MCPManager } = await import('../../mcp/client.js');
        mcpManager = new MCPManager();
        mcpManagers.set(ctx.sessionId, mcpManager);

        const servers = Array.isArray(ctx.mcpServers)
          ? ctx.mcpServers
          : typeof ctx.mcpServers === 'object' && ctx.mcpServers !== null
            ? Object.entries(ctx.mcpServers).map(([name, conf]) => ({ name, ...(conf as object) }))
            : [];

        for (const server of servers) {
          try {
            await mcpManager.addServer(server);
          } catch (e) {
            logger.warn(`Failed to add MCP server ${server.name}`, { error: String(e) });
          }
        }
      } catch (e) {
        logger.warn('Failed to initialize MCPManager for passthrough', { error: String(e) });
      }
    }

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ];

    const allTools: CodeBuddyTool[] = [...READONLY_TOOLS];
    if (ctx.canRequestClient('fs/write_text_file')) {
      allTools.push(WRITE_FILE_TOOL);
    }
    if (mcpManager) {
      const mcpTools = mcpManager.getTools().map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        }
      } as CodeBuddyTool));
      allTools.push(...mcpTools);
    }

    let toolCallSeq = 0;

    for (let round = 0; round < maxRounds; round++) {
      if (ctx.signal.aborted) return { stopReason: 'cancelled' };

      let response: CodeBuddyResponse;
      try {
        response = await options.chat(messages, allTools);
      } catch (err) {
        if (ctx.signal.aborted) return { stopReason: 'cancelled' };
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('[acp-agentic] LLM call failed', { message });
        ctx.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Error: ${message}` },
        });
        return { stopReason: 'refusal' };
      }
      if (ctx.signal.aborted) return { stopReason: 'cancelled' };

      const choice = response.choices?.[0]?.message;
      const toolCalls = choice?.tool_calls ?? [];
      const assistantText = typeof choice?.content === 'string' ? choice.content : '';

      // No tool calls → final answer.
      if (toolCalls.length === 0) {
        ctx.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: assistantText || '(no response)' },
        });
        return { stopReason: 'end_turn' };
      }

      // Record the assistant turn (with its tool_calls) before appending results.
      messages.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls,
      } as CodeBuddyMessage);

      for (const call of toolCalls) {
        if (ctx.signal.aborted) return { stopReason: 'cancelled' };

        const toolCallId = `tool-${++toolCallSeq}`;
        const args = parseToolArgs(call);
        const kind = TOOL_KIND[call.function.name] ?? 'read';

        ctx.sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId,
          title: describeToolCall(call.function.name, args),
          kind,
          status: 'in_progress',
          rawInput: args,
        });

        let result: ToolExecResult;
        if (call.function.name.startsWith('mcp__') && mcpManager) {
          try {
            const mcpRes = await mcpManager.callTool(call.function.name, args);
            const outputText = Array.isArray(mcpRes.content)
              ? mcpRes.content.map((c: any) => c.text).join('\n')
              : String(mcpRes);
            result = { output: outputText, isError: !!mcpRes.isError };
          } catch (e) {
            result = { output: String(e), isError: true };
          }
        } else {
          result = await executeAcpTool({
            name: call.function.name,
            args,
            ctx,
            toolCallId,
            maxToolOutputBytes,
          });
        }
        if (ctx.signal.aborted) return { stopReason: 'cancelled' };

        ctx.sendUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: result.isError ? 'failed' : 'completed',
          content: [{ type: 'content', content: { type: 'text', text: result.output } }],
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.output,
        } as CodeBuddyMessage);
      }
    }

    // Loop exhausted without a final answer.
    logger.warn('[acp-agentic] max rounds reached', { maxRounds });
    ctx.sendUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `Stopped after ${maxRounds} tool rounds without a final answer.` },
    });
    return { stopReason: 'max_turn_requests' };
  };
}

// ──────────────────────────────────────────────────────────────────
// Tool execution
// ──────────────────────────────────────────────────────────────────

interface ExecuteAcpToolInput {
  name: string;
  args: Record<string, unknown>;
  ctx: AcpPromptContext;
  toolCallId: string;
  maxToolOutputBytes: number;
}

async function executeAcpTool(input: ExecuteAcpToolInput): Promise<ToolExecResult> {
  const { name, args, ctx, toolCallId, maxToolOutputBytes } = input;
  try {
    switch (name) {
      case 'view_file':
        return { output: await readFileViaClientOrDisk(args, ctx, toolCallId, maxToolOutputBytes), isError: false };
      case 'list_directory':
        return { output: await listDirectory(args, ctx.cwd), isError: false };
      case 'search':
        return { output: await searchWorkspace(args, ctx.cwd, maxToolOutputBytes), isError: false };
      case 'write_file':
        return { output: await writeFileViaClientOrDisk(args, ctx, toolCallId), isError: false };
      default:
        return { output: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[acp-agentic] tool execution failed', { tool: name, message });
    return { output: `Error: ${message}`, isError: true };
  }
}

/**
 * Read a file. When the client advertises `fs.readTextFile`, route through
 * the editor buffer (gated by `session/request_permission` first); otherwise
 * read from disk, scoped to the session `cwd`.
 */
async function readFileViaClientOrDisk(
  args: Record<string, unknown>,
  ctx: AcpPromptContext,
  toolCallId: string,
  maxBytes: number,
): Promise<string> {
  const rawPath = stringArg(args, 'file_path') ?? stringArg(args, 'path');
  if (!rawPath) throw new Error('view_file: missing string file_path');

  const useClient = ctx.canRequestClient('fs/read_text_file');

  if (useClient) {
    // ACP fs/read_text_file requires an absolute path.
    const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath);

    // Gate the read behind an explicit client permission when available.
    // Throwing on denial surfaces the tool call as `failed` to the editor
    // rather than a spuriously "completed" read that returned nothing.
    if (ctx.canRequestClient('session/request_permission')) {
      const allowed = await requestPermission(ctx, toolCallId, absolute);
      if (!allowed) {
        throw new Error(`Permission to read ${rawPath} was denied by the editor.`);
      }
    }

    const result = await ctx.requestClient('fs/read_text_file', { sessionId: ctx.sessionId, path: absolute });
    const content = extractClientReadContent(result);
    return truncate(content, maxBytes);
  }

  // Disk fallback, scoped to cwd.
  const resolved = resolveInsideCwd(rawPath, ctx.cwd);
  const content = await fs.readFile(resolved, 'utf-8');
  return truncate(content, maxBytes);
}

/**
 * Write a file through the editor client. There is deliberately no direct disk
 * fallback: ACP writes are only allowed when the editor advertises
 * `fs.writeTextFile`, and they are always gated by client permission.
 */
async function writeFileViaClientOrDisk(
  args: Record<string, unknown>,
  ctx: AcpPromptContext,
  toolCallId: string,
): Promise<string> {
  const rawPath = stringArg(args, 'file_path') ?? stringArg(args, 'path');
  const content = stringArg(args, 'content');
  if (!rawPath) throw new Error('write_file: missing string file_path');
  if (typeof content !== 'string') throw new Error('write_file: missing string content');

  if (!ctx.canRequestClient('fs/write_text_file')) {
    throw new Error('write_file is unavailable because the ACP client did not advertise fs.writeTextFile.');
  }

  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath);
  const allowed = await requestPermission(ctx, toolCallId, absolute);
  if (!allowed) {
    throw new Error(`Permission to write ${rawPath} was denied by the editor.`);
  }

  await ctx.requestClient('fs/write_text_file', { sessionId: ctx.sessionId, path: absolute, content });
  return `Successfully wrote to ${rawPath} via editor client`;
}

async function requestPermission(ctx: AcpPromptContext, toolCallId: string, target: string): Promise<boolean> {
  const outcome = await ctx.requestClient('session/request_permission', {
    sessionId: ctx.sessionId,
    // Reference the live tool call so the editor correlates the prompt.
    toolCall: { toolCallId },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
    _meta: { target },
  });
  return permissionGranted(outcome);
}

function permissionGranted(outcome: unknown): boolean {
  if (!outcome || typeof outcome !== 'object') return false;
  const record = outcome as Record<string, unknown>;
  const inner = record.outcome;
  if (!inner || typeof inner !== 'object') return false;
  const innerRecord = inner as Record<string, unknown>;
  if (innerRecord.outcome !== 'selected') return false;
  return innerRecord.optionId === 'allow';
}

function extractClientReadContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
  }
  throw new Error('fs/read_text_file returned no string content');
}

async function listDirectory(args: Record<string, unknown>, cwd: string): Promise<string> {
  const rawPath = stringArg(args, 'path') ?? stringArg(args, 'directory') ?? '.';
  const resolved = resolveInsideCwd(rawPath, cwd);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const lines = entries
    .map((e) => {
      const tag = e.isDirectory() ? 'DIR ' : e.isSymbolicLink() ? 'LINK' : 'FILE';
      return `${tag}  ${e.name}`;
    })
    .sort();
  const truncated = lines.length > LIST_DIRECTORY_MAX_ENTRIES;
  const visible = truncated ? lines.slice(0, LIST_DIRECTORY_MAX_ENTRIES) : lines;
  if (truncated) {
    visible.push(`... truncated after ${LIST_DIRECTORY_MAX_ENTRIES} entries (${lines.length} total)`);
  }
  return visible.join('\n');
}

function searchWorkspace(args: Record<string, unknown>, cwd: string, maxBytes: number): Promise<string> {
  const query = stringArg(args, 'query') ?? stringArg(args, 'pattern');
  if (!query) throw new Error('search: missing string query');
  const rawPath = stringArg(args, 'path') ?? '.';
  const resolved = resolveInsideCwd(rawPath, cwd);

  return new Promise<string>((resolve, reject) => {
    const rgArgs = ['--no-heading', '--line-number', '--color', 'never', '--max-count', '50', '--', query, resolved];
    const proc = spawn(rgPath, rgArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let lineCount = 0;

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`search: ripgrep did not finish within ${SEARCH_TIMEOUT_MS}ms`));
    }, SEARCH_TIMEOUT_MS);
    timer.unref?.();

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
      lineCount = stdout.split('\n').length;
      if (lineCount > SEARCH_MAX_RESULTS) {
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      }
    });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf-8'); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      // 0 = matches, 1 = no matches (still ok), 2 = error.
      if (code === 0 || code === 1 || (code === null && stdout.length > 0)) {
        resolve(truncate(stdout || '(no matches)', maxBytes));
      } else {
        reject(new Error(`search: ripgrep exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function extractPromptText(prompt: AcpContentBlock[]): string {
  return prompt
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

function parseToolArgs(call: CodeBuddyToolCall): Record<string, unknown> {
  const raw = call.function.arguments;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'view_file':
      return `Read ${stringArg(args, 'file_path') ?? stringArg(args, 'path') ?? 'file'}`;
    case 'list_directory':
      return `List ${stringArg(args, 'path') ?? stringArg(args, 'directory') ?? '.'}`;
    case 'search':
      return `Search "${stringArg(args, 'query') ?? stringArg(args, 'pattern') ?? ''}"`;
    default:
      return name;
  }
}

/**
 * Resolve a path against the session cwd and ensure it stays inside it.
 * Prevents the disk-fallback path from escaping the workspace root.
 */
function resolveInsideCwd(rawPath: string, cwd: string): string {
  const root = path.resolve(cwd);
  const absolute = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootPrefix)) {
    throw new Error(`path ${rawPath} resolves outside the workspace (${cwd})`);
  }
  return absolute;
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n... [truncated]`;
}

/** Test-only: the static read-only toolset this runner always exposes. */
export const ACP_READONLY_TOOLS: ReadonlyArray<CodeBuddyTool> = READONLY_TOOLS;
