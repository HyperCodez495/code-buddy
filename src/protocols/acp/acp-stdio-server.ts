/**
 * ACP (Agent Client Protocol) stdio server — editor integration.
 *
 * This is the **Zed Agent Client Protocol** (https://agentclientprotocol.com):
 * a code editor (the *client*) spawns Code Buddy as a subprocess and exchanges
 * JSON-RPC 2.0 messages over **newline-delimited JSON on stdio**. It is distinct
 * from Code Buddy's internal `src/acp/protocol.ts` (agent message router) and the
 * HTTP "Agent Communication Protocol" in `src/protocols/acp/acp-server.ts`.
 *
 * Implemented methods (grounded in the published spec):
 * - `initialize`        → capability negotiation (integer protocolVersion).
 * - `session/new`       → `{ sessionId }`.
 * - `session/prompt`    → runs the injected prompt runner, streaming
 *                         `session/update` (`agent_message_chunk`) notifications,
 *                         resolving to `{ stopReason }`.
 * - `session/cancel`    → notification; aborts the active turn (→ `cancelled`).
 *
 * The transport + protocol layer is deliberate-and-tested; the `promptRunner`
 * is injected so the CLI wires the real agent while tests drive a deterministic
 * runner. Out of scope for v1 (documented, not stubbed): client-side `fs/*` +
 * `session/request_permission` calls, `session/load`, and MCP passthrough.
 */

import { randomUUID } from 'crypto';
import type { Readable, Writable } from 'node:stream';

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export interface AcpSessionUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface AcpPromptContext {
  sessionId: string;
  cwd: string;
  prompt: AcpContentBlock[];
  signal: AbortSignal;
  sendUpdate: (update: AcpSessionUpdate) => void;
}

export type AcpPromptRunner = (ctx: AcpPromptContext) => Promise<{ stopReason: AcpStopReason }>;

export interface AcpAgentInfo {
  name: string;
  title?: string;
  version: string;
}

export interface AcpStdioServerOptions {
  promptRunner: AcpPromptRunner;
  /** Defaults to process.stdin. */
  input?: Readable;
  /** Defaults to process.stdout. */
  output?: Writable;
  agentInfo?: AcpAgentInfo;
  protocolVersion?: number;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface AcpSession {
  cwd: string;
  active: AbortController | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class AcpStdioServer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly promptRunner: AcpPromptRunner;
  private readonly agentInfo: AcpAgentInfo;
  private readonly protocolVersion: number;
  private readonly sessions = new Map<string, AcpSession>();
  private buffer = '';
  private started = false;
  private readonly onData = (chunk: Buffer | string): void => this.ingest(chunk);

  constructor(options: AcpStdioServerOptions) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.promptRunner = options.promptRunner;
    this.agentInfo = options.agentInfo ?? { name: 'Code Buddy', title: 'Code Buddy', version: '1.0.0' };
    this.protocolVersion = options.protocolVersion ?? ACP_PROTOCOL_VERSION;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.setEncoding?.('utf8');
    this.input.on('data', this.onData);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.input.off?.('data', this.onData);
  }

  private ingest(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) void this.handleLine(line);
    }
  }

  private write(message: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private sendUpdate(sessionId: string, update: AcpSessionUpdate): void {
    this.write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  private async handleLine(line: string): Promise<void> {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }

    const id = msg.id;
    const isRequest = id !== undefined && id !== null;
    const method = msg.method;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    // `session/cancel` is a notification (no response).
    if (method === 'session/cancel') {
      this.handleCancel(params);
      return;
    }

    if (!isRequest || typeof method !== 'string') {
      // Ignore other notifications and any client responses.
      return;
    }

    try {
      const result = await this.dispatch(method, params);
      this.write({ jsonrpc: '2.0', id, result });
    } catch (err) {
      const error = err as { code?: number; message?: string };
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: error.code ?? -32603, message: error.message ?? String(err) },
      });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize();
      case 'session/new':
        return this.handleNewSession(params);
      case 'session/prompt':
        return this.handlePrompt(params);
      default: {
        const error = new Error(`Method not found: ${method}`) as Error & { code?: number };
        error.code = -32601;
        throw error;
      }
    }
  }

  private handleInitialize(): unknown {
    return {
      protocolVersion: this.protocolVersion,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
      },
      agentInfo: this.agentInfo,
      authMethods: [],
    };
  }

  private handleNewSession(params: Record<string, unknown>): unknown {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { cwd: asString(params.cwd) ?? process.cwd(), active: null });
    return { sessionId };
  }

  private async handlePrompt(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = asString(params.sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session) {
      const error = new Error('Unknown or missing sessionId') as Error & { code?: number };
      error.code = -32602;
      throw error;
    }

    const prompt = Array.isArray(params.prompt) ? (params.prompt as AcpContentBlock[]) : [];
    const controller = new AbortController();
    session.active = controller;

    try {
      const { stopReason } = await this.promptRunner({
        sessionId,
        cwd: session.cwd,
        prompt,
        signal: controller.signal,
        sendUpdate: (update) => this.sendUpdate(sessionId, update),
      });
      return { stopReason: controller.signal.aborted ? 'cancelled' : stopReason };
    } catch (err) {
      if (controller.signal.aborted) return { stopReason: 'cancelled' };
      throw err;
    } finally {
      session.active = null;
    }
  }

  private handleCancel(params: Record<string, unknown>): void {
    const sessionId = asString(params.sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    session?.active?.abort();
  }
}
