/**
 * Chat Routes
 *
 * Handles chat completion API endpoints.
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../types.js';
import {
  createServerAgent,
  listServerModels,
  runAgentCompletion,
  streamAgentDeltas,
  type ServerAgent,
} from '../agent-adapter.js';
// Lazy import to avoid circular dependency through channels/index.ts
// (channels/index.ts re-exports channel classes that import BaseChannel
// before it's fully initialized)
let _enqueueMessage: typeof import('../../channels/index.js').enqueueMessage;
async function getEnqueueMessage() {
  if (!_enqueueMessage) {
    const mod = await import('../../channels/index.js');
    _enqueueMessage = mod.enqueueMessage;
  }
  return _enqueueMessage;
}

// Lazy load the agent
let agentInstance: ServerAgent | null = null;

async function getAgent(): Promise<ServerAgent> {
  if (!agentInstance) {
    agentInstance = await createServerAgent();
  }
  return agentInstance!;
}

const router = Router();

type ProviderErrorShape = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  retryAfter?: unknown;
  response?: {
    status?: unknown;
    headers?: unknown;
  };
  headers?: unknown;
};

function readFiniteStatus(value: unknown): number | undefined {
  const status = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    return undefined;
  }
  return status;
}

function readHeader(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
}

function readRetryAfterSeconds(error: unknown): number | undefined {
  const shaped = error as ProviderErrorShape;
  const direct = Number(shaped?.retryAfter);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.ceil(direct);
  }

  const headerValue =
    readHeader(shaped?.headers, 'retry-after') ??
    readHeader(shaped?.response?.headers, 'retry-after');
  const fromHeader = Number(headerValue);
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return Math.ceil(fromHeader);
  }

  return undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function getProviderStatus(error: unknown): number | undefined {
  const shaped = error as ProviderErrorShape;
  const explicit =
    readFiniteStatus(shaped?.statusCode) ??
    readFiniteStatus(shaped?.status) ??
    readFiniteStatus(shaped?.response?.status);
  if (explicit) {
    return explicit;
  }

  const lower = getErrorMessage(error, '').toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota')) {
    return 429;
  }
  if (lower.includes('timeout') || lower.includes('econnreset') || lower.includes('socket hang up')) {
    return 503;
  }
  return undefined;
}

function toProviderApiError(error: unknown): ApiServerError {
  const message = getErrorMessage(error, 'Unknown provider error');
  const providerStatus = getProviderStatus(error);

  if (providerStatus === 429) {
    const retryAfter = readRetryAfterSeconds(error);
    return new ApiServerError(
      message,
      'RATE_LIMITED',
      429,
      {
        providerStatus,
        ...(retryAfter ? { retryAfter } : {}),
      }
    );
  }

  if (providerStatus && providerStatus >= 500) {
    return new ApiServerError(message, 'PROVIDER_UNAVAILABLE', providerStatus, {
      providerStatus,
    });
  }

  if (providerStatus) {
    return new ApiServerError(message, 'PROVIDER_ERROR', 502, {
      providerStatus,
    });
  }

  return ApiServerError.internal(message);
}

function setRetryAfterHeader(res: Response, error: ApiServerError): void {
  const retryAfter = error.details?.retryAfter;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    res.setHeader('Retry-After', Math.ceil(retryAfter).toString());
  }
}

function openAIErrorType(error: ApiServerError): string {
  if (error.code === 'RATE_LIMITED') {
    return 'rate_limit_error';
  }
  if (error.code === 'PROVIDER_ERROR') {
    return 'provider_error';
  }
  return 'server_error';
}

/**
 * POST /api/chat
 * Send a chat message and get a response
 */
router.post(
  '/',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as ChatRequest;

    // Validate required fields
    validateRequired(body, ['messages']);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw ApiServerError.badRequest('Messages must be a non-empty array');
    }

    // Validate each message structure
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg || typeof msg !== 'object') {
        throw ApiServerError.badRequest(`Message at index ${i} must be an object`);
      }
      if (!msg.role || typeof msg.role !== 'string') {
        throw ApiServerError.badRequest(`Message at index ${i} must have a valid 'role' field`);
      }
      if (!['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
        throw ApiServerError.badRequest(`Message at index ${i} has invalid role '${msg.role}'. Must be one of: system, user, assistant, tool`);
      }
      if (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string') {
        throw ApiServerError.badRequest(`Message at index ${i} has invalid content type. Must be a string or null`);
      }
    }

    // Validate optional parameters
    if (body.model !== undefined && (typeof body.model !== 'string' || body.model.trim().length === 0)) {
      throw ApiServerError.badRequest('Model must be a non-empty string if provided');
    }
    if (body.temperature !== undefined) {
      const temp = Number(body.temperature);
      if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
        throw ApiServerError.badRequest('Temperature must be a number between 0 and 2');
      }
    }
    if (body.maxTokens !== undefined) {
      const maxTok = Number(body.maxTokens);
      if (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > 200000) {
        throw ApiServerError.badRequest('maxTokens must be an integer between 1 and 200000');
      }
    }

    // Check for streaming
    if (body.stream) {
      // Require stream scope for streaming
      if (!req.auth?.scopes.includes('chat:stream') && !req.auth?.scopes.includes('admin')) {
        throw ApiServerError.forbidden('Streaming requires chat:stream scope');
      }

      return handleStreamingChat(req, res, body, startTime);
    }

    // Non-streaming response
    // Use session key from request body (or a default) for lane queue serialization
    const sessionKey = `api:chat:${body.sessionId || 'default'}`;
    const agent = await getAgent();
    const requestId = randomBytes(8).toString('hex');

    try {
      // Enqueue through lane queue for per-session serialization
      const enqueueMessage = await getEnqueueMessage();
      const result = await enqueueMessage(sessionKey, async () => {
        // Process messages
        const messages = body.messages as ChatCompletionMessageParam[];

        // Add system prompt if provided
        if (body.systemPrompt && messages[0]?.role !== 'system') {
          messages.unshift({
            role: 'system',
            content: body.systemPrompt,
          });
        }

        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
          throw ApiServerError.badRequest('Messages must be a non-empty array');
        }

        return runAgentCompletion(
          agent,
          lastMessage.content as string,
          { model: body.model }
        );
      });

      const response: ChatResponse = {
        id: requestId,
        content: result.content || '',
        model: body.model || agent.getCurrentModel(),
        finishReason: (result.finishReason as ChatResponse['finishReason']) || 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        toolCalls: result.toolCalls?.map((tc) => ({
          name: tc.name,
          callId: tc.id,
          success: tc.success ?? true,
          output: tc.output,
          error: tc.error,
          executionTime: tc.executionTime || 0,
        })),
        sessionId: body.sessionId,
        latency: Date.now() - startTime,
      };

      res.json(response);
    } catch (error: unknown) {
      const apiError = toProviderApiError(error);
      setRetryAfterHeader(res, apiError);
      throw apiError;
    }
  })
);

/**
 * Handle streaming chat response (legacy Code Buddy format)
 */
async function handleStreamingChat(
  req: Request,
  res: Response,
  body: ChatRequest,
  _startTime: number
): Promise<void> {
  const requestId = randomBytes(8).toString('hex');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Request-ID', requestId);

  // Handle client disconnect
  let isConnected = true;
  req.on('aborted', () => {
    isConnected = false;
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      isConnected = false;
    }
  });

  try {
    const agent = await getAgent();
    const messages = body.messages as ChatCompletionMessageParam[];

    // Add system prompt if provided
    if (body.systemPrompt && messages[0]?.role !== 'system') {
      messages.unshift({
        role: 'system',
        content: body.systemPrompt,
      });
    }

    // Stream the response
    let _totalContent = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      throw ApiServerError.badRequest('Messages must be a non-empty array');
    }

    const stream = streamAgentDeltas(
      agent,
      lastMessage.content as string,
      { model: body.model }
    );

    for await (const delta of stream) {
      if (!isConnected) break;

      _totalContent += delta;

      const streamChunk: ChatStreamChunk = {
        id: requestId,
        delta,
        done: false,
      };

      res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
    }

    // Send final chunk
    if (isConnected) {
      const finalChunk: ChatStreamChunk = {
        id: requestId,
        delta: '',
        done: true,
        finishReason: 'stop',
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
      };

      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
    }

    res.end();
  } catch (error: unknown) {
    const apiError = toProviderApiError(error);
    const errorChunk = {
      id: requestId,
      delta: '',
      done: true,
      error: {
        code: apiError.code,
        message: apiError.message,
        status: apiError.status,
        details: apiError.details,
      },
    };

    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.end();
  }
}

/**
 * Handle streaming chat response (OpenAI-compatible format)
 *
 * Sends SSE chunks in the standard OpenAI chat.completion.chunk format
 * so third-party clients (e.g. Cursor, Continue, litellm) work out of the box.
 */
async function handleOpenAIStreamingChat(
  req: Request,
  res: Response,
  body: ChatRequest,
  _startTime: number
): Promise<void> {
  const requestId = `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);
  const modelName = body.model || (await getAgent()).getCurrentModel();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Request-ID', requestId);

  // Handle client disconnect
  let isConnected = true;
  req.on('aborted', () => {
    isConnected = false;
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      isConnected = false;
    }
  });

  try {
    const agent = await getAgent();
    const messages = body.messages as ChatCompletionMessageParam[];

    // Add system prompt if provided
    if (body.systemPrompt && messages[0]?.role !== 'system') {
      messages.unshift({
        role: 'system',
        content: body.systemPrompt,
      });
    }

    // Estimate prompt tokens from input messages
    const promptText = messages.map(m => (typeof m.content === 'string' ? m.content : '')).join('');
    const promptTokens = Math.ceil(promptText.length / 4);
    let completionTokens = 0;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      throw ApiServerError.badRequest('Messages must be a non-empty array');
    }

    const stream = streamAgentDeltas(
      agent,
      lastMessage.content as string,
      { model: body.model }
    );

    for await (const delta of stream) {
      if (!isConnected) break;

      completionTokens += Math.ceil(delta.length / 4);

      const openaiChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            delta: { content: delta },
            finish_reason: null,
          },
        ],
      };

      res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
    }

    // Send final chunk with finish_reason and usage
    if (isConnected) {
      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };

      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
    }

    res.end();
  } catch (error: unknown) {
    const apiError = toProviderApiError(error);
    const errorChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    };

    // Send error as a final chunk then an error event
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.write(`data: ${JSON.stringify({
      error: {
        message: apiError.message,
        type: openAIErrorType(apiError),
        code: apiError.code,
        status: apiError.status,
        details: apiError.details,
      },
    })}\n\n`);
    res.end();
  }
}

/**
 * POST /api/chat/completions
 * OpenAI-compatible chat completions endpoint
 */
router.post(
  '/completions',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body;

    // Validate required fields (OpenAI format)
    try {
      validateRequired(body, ['messages']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid request';
      res.status(400).json({
        error: { message: msg, type: 'invalid_request_error', code: null },
      });
      return;
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: { message: 'Messages must be a non-empty array', type: 'invalid_request_error', code: null },
      });
      return;
    }

    // Convert to our format
    const chatRequest: ChatRequest = {
      messages: body.messages,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      stream: body.stream,
    };

    if (body.stream) {
      // Use OpenAI-compatible streaming format for /completions
      return handleOpenAIStreamingChat(req, res, chatRequest, startTime);
    }

    try {
      const agent = await getAgent();
      const requestId = `chatcmpl-${randomBytes(12).toString('hex')}`;

      const messages = body.messages as ChatCompletionMessageParam[];
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        throw ApiServerError.badRequest('Messages must be a non-empty array');
      }

      const result = await runAgentCompletion(
        agent,
        lastMessage.content as string,
        { model: body.model }
      );

      // Estimate token counts when the provider doesn't return them
      const promptText = messages.map(m => (typeof m.content === 'string' ? m.content : '')).join('');
      const estimatedPromptTokens = Math.ceil(promptText.length / 4);
      const completionText = result.content || '';
      const estimatedCompletionTokens = Math.ceil(completionText.length / 4);

      // Return OpenAI-compatible response
      const response = {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || agent.getCurrentModel(),
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: completionText,
            },
            finish_reason: result.finishReason || 'stop',
          },
        ],
        usage: {
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedPromptTokens + estimatedCompletionTokens,
        },
      };

      res.json(response);
    } catch (error: unknown) {
      const apiError = toProviderApiError(error);
      setRetryAfterHeader(res, apiError);
      res.status(apiError.status).json({
        error: {
          message: apiError.message,
          type: openAIErrorType(apiError),
          code: apiError.code,
          details: apiError.details,
        },
      });
    }
  })
);

/**
 * GET /api/chat/models
 * List available models
 */
router.get(
  '/models',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      object: 'list',
      data: listServerModels(),
    });
  })
);

export default router;
