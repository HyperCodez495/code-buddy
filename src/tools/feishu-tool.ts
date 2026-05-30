import type { ToolResult } from '../types/index.js';

export type FeishuToolName =
  | 'feishu_doc_read'
  | 'feishu_drive_list_comments'
  | 'feishu_drive_list_comment_replies'
  | 'feishu_drive_reply_comment'
  | 'feishu_drive_add_comment';

export interface FeishuToolOptions {
  accessToken?: string;
  appId?: string;
  appSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

interface FeishuContext {
  accessToken: string;
  baseUrl: string;
  credentialSource: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  userAgent: string;
}

interface FeishuSuccessPayload {
  success: true;
  provider: 'feishu';
  credential_source: string;
  tool: FeishuToolName;
  endpoint: string;
  data: unknown;
  content?: string;
}

const DEFAULT_FEISHU_BASE_URL = 'https://open.feishu.cn';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAGE_SIZE = 100;

export async function executeFeishuTool(
  toolName: FeishuToolName,
  input: Record<string, unknown>,
  options: FeishuToolOptions = {},
): Promise<ToolResult> {
  try {
    const context = await resolveFeishuContext(options);
    const payload = await executeFeishuOperation(toolName, input, context);
    return {
      success: true,
      output: JSON.stringify(payload, null, 2),
      data: payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      success: false,
      provider: 'feishu',
      tool: toolName,
      error: message,
      error_type: error instanceof Error ? error.name : 'Error',
    };
    return {
      success: false,
      error: message,
      output: JSON.stringify(payload, null, 2),
      data: payload,
    };
  }
}

async function executeFeishuOperation(
  toolName: FeishuToolName,
  input: Record<string, unknown>,
  context: FeishuContext,
): Promise<FeishuSuccessPayload> {
  switch (toolName) {
    case 'feishu_doc_read': {
      const docToken = requiredString(input, 'doc_token');
      const endpoint = fillPath('/open-apis/docx/v1/documents/:document_id/raw_content', {
        document_id: docToken,
      });
      const body = await requestFeishuJson(context, 'GET', endpoint);
      const data = asRecord(body).data ?? {};
      const content = extractDocumentContent(body);
      return success(toolName, context, endpoint, data, { content });
    }
    case 'feishu_drive_list_comments': {
      const fileToken = requiredString(input, 'file_token');
      const pageSize = normalizePageSize(input.page_size, 'page_size');
      const endpoint = fillPath('/open-apis/drive/v1/files/:file_token/comments', {
        file_token: fileToken,
      });
      const query: Record<string, string> = {
        file_type: optionalString(input, 'file_type') ?? 'docx',
        user_id_type: 'open_id',
        page_size: String(pageSize),
      };
      if (coerceBoolean(input.is_whole)) {
        query.is_whole = 'true';
      }
      const pageToken = optionalString(input, 'page_token');
      if (pageToken) {
        query.page_token = pageToken;
      }
      const body = await requestFeishuJson(context, 'GET', endpoint, { query });
      return success(toolName, context, endpoint, asRecord(body).data ?? {});
    }
    case 'feishu_drive_list_comment_replies': {
      const fileToken = requiredString(input, 'file_token');
      const commentId = requiredString(input, 'comment_id');
      const pageSize = normalizePageSize(input.page_size, 'page_size');
      const endpoint = fillPath('/open-apis/drive/v1/files/:file_token/comments/:comment_id/replies', {
        file_token: fileToken,
        comment_id: commentId,
      });
      const query: Record<string, string> = {
        file_type: optionalString(input, 'file_type') ?? 'docx',
        user_id_type: 'open_id',
        page_size: String(pageSize),
      };
      const pageToken = optionalString(input, 'page_token');
      if (pageToken) {
        query.page_token = pageToken;
      }
      const body = await requestFeishuJson(context, 'GET', endpoint, { query });
      return success(toolName, context, endpoint, asRecord(body).data ?? {});
    }
    case 'feishu_drive_reply_comment': {
      const fileToken = requiredString(input, 'file_token');
      const commentId = requiredString(input, 'comment_id');
      const content = requiredString(input, 'content');
      const fileType = optionalString(input, 'file_type') ?? 'docx';
      const endpoint = fillPath('/open-apis/drive/v1/files/:file_token/comments/:comment_id/replies', {
        file_token: fileToken,
        comment_id: commentId,
      });
      const body = await requestFeishuJson(context, 'POST', endpoint, {
        query: { file_type: fileType },
        body: {
          content: {
            elements: [
              {
                type: 'text_run',
                text_run: { text: content },
              },
            ],
          },
        },
      });
      return success(toolName, context, endpoint, asRecord(body).data ?? {});
    }
    case 'feishu_drive_add_comment': {
      const fileToken = requiredString(input, 'file_token');
      const content = requiredString(input, 'content');
      const fileType = optionalString(input, 'file_type') ?? 'docx';
      const endpoint = fillPath('/open-apis/drive/v1/files/:file_token/new_comments', {
        file_token: fileToken,
      });
      const body = await requestFeishuJson(context, 'POST', endpoint, {
        body: {
          file_type: fileType,
          reply_elements: [
            {
              type: 'text',
              text: content,
            },
          ],
        },
      });
      return success(toolName, context, endpoint, asRecord(body).data ?? {});
    }
  }
}

async function resolveFeishuContext(options: FeishuToolOptions): Promise<FeishuContext> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  const baseUrl = normalizeBaseUrl(
    options.baseUrl
    ?? process.env.FEISHU_BASE_URL
    ?? process.env.LARK_BASE_URL
    ?? DEFAULT_FEISHU_BASE_URL,
  );
  const directToken = trim(
    options.accessToken
    ?? process.env.FEISHU_TENANT_ACCESS_TOKEN
    ?? process.env.LARK_TENANT_ACCESS_TOKEN
    ?? process.env.FEISHU_ACCESS_TOKEN
    ?? process.env.LARK_ACCESS_TOKEN,
  );
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const userAgent = options.userAgent ?? `Code-Buddy/${process.env.npm_package_version ?? 'dev'}`;
  if (directToken) {
    return {
      accessToken: directToken,
      baseUrl,
      credentialSource: options.accessToken ? 'option' : 'access_token_env',
      fetchImpl,
      timeoutMs,
      userAgent,
    };
  }

  const appId = trim(options.appId ?? process.env.FEISHU_APP_ID ?? process.env.LARK_APP_ID);
  const appSecret = trim(options.appSecret ?? process.env.FEISHU_APP_SECRET ?? process.env.LARK_APP_SECRET);
  if (!appId || !appSecret) {
    throw new Error(
      'No Feishu credentials available. Set FEISHU_TENANT_ACCESS_TOKEN or FEISHU_APP_ID/FEISHU_APP_SECRET.',
    );
  }

  const tokenPayload = await requestJson({
    fetchImpl,
    baseUrl,
    method: 'POST',
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: {
      app_id: appId,
      app_secret: appSecret,
    },
    timeoutMs,
  });
  assertFeishuOk(tokenPayload, 'Fetch tenant access token failed');
  const token = trim(asRecord(tokenPayload).tenant_access_token);
  if (!token) {
    throw new Error('Fetch tenant access token failed: missing tenant_access_token');
  }
  return {
    accessToken: token,
    baseUrl,
    credentialSource: options.appId || options.appSecret ? 'app_credentials_option' : 'app_credentials_env',
    fetchImpl,
    timeoutMs,
    userAgent,
  };
}

async function requestFeishuJson(
  context: FeishuContext,
  method: 'GET' | 'POST',
  path: string,
  request: { query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  const payload = await requestJson({
    fetchImpl: context.fetchImpl,
    baseUrl: context.baseUrl,
    method,
    path,
    query: request.query,
    headers: {
      Authorization: `Bearer ${context.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': context.userAgent,
    },
    body: request.body,
    timeoutMs: context.timeoutMs,
  });
  assertFeishuOk(payload, `${method} ${path} failed`);
  return payload;
}

async function requestJson(options: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  const url = buildUrl(options.baseUrl, options.path, options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      method: options.method,
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? parseJsonOrText(text) : {};
    if (!response.ok) {
      throw new Error(httpErrorMessage(response.status, parsed));
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Feishu request timed out after ${options.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertFeishuOk(payload: unknown, prefix: string): void {
  const record = asRecord(payload);
  const code = record.code;
  if (typeof code === 'number' && code !== 0) {
    const msg = typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : 'unknown error';
    throw new Error(`${prefix}: code=${code} msg=${msg}`);
  }
}

function success(
  tool: FeishuToolName,
  context: FeishuContext,
  endpoint: string,
  data: unknown,
  extra: { content?: string } = {},
): FeishuSuccessPayload {
  return {
    success: true,
    provider: 'feishu',
    credential_source: context.credentialSource,
    tool,
    endpoint,
    data,
    ...extra,
  };
}

function extractDocumentContent(payload: unknown): string {
  const data = asRecord(asRecord(payload).data);
  const content = data.content;
  return typeof content === 'string' ? content : '';
}

function normalizePageSize(value: unknown, fieldName: string): number {
  if (value === undefined || value === null || value === '') {
    return MAX_PAGE_SIZE;
  }
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > MAX_PAGE_SIZE) {
    throw new Error(`${fieldName} must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return numberValue;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  return trim(input[key]) || undefined;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function fillPath(template: string, params: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(value));
  }
  return result;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): URL {
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function httpErrorMessage(status: number, parsed: unknown): string {
  const record = asRecord(parsed);
  const code = typeof record.code === 'number' || typeof record.code === 'string' ? String(record.code) : '';
  const msg = typeof record.msg === 'string'
    ? record.msg
    : typeof record.message === 'string'
      ? record.message
      : typeof parsed === 'string'
        ? parsed.slice(0, 500)
        : '';
  if (code && msg) {
    return `Feishu request failed with status ${status}: code=${code} msg=${msg}`;
  }
  if (msg) {
    return `Feishu request failed with status ${status}: ${msg}`;
  }
  return `Feishu request failed with status ${status}`;
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
