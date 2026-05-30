export type DiscordCoreAction = 'fetch_messages' | 'search_members' | 'create_thread';
export type DiscordAdminAction =
  | 'list_guilds'
  | 'server_info'
  | 'list_channels'
  | 'channel_info'
  | 'list_roles'
  | 'member_info'
  | 'list_pins'
  | 'pin_message'
  | 'unpin_message'
  | 'delete_message'
  | 'add_role'
  | 'remove_role';
export type DiscordAction = DiscordCoreAction | DiscordAdminAction;

export interface DiscordToolOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface DiscordToolExecutionResult {
  kind: 'discord_result';
  ok: boolean;
  action: DiscordAction;
  data?: unknown;
  request?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
  };
  error?: string;
}

interface DiscordRequestOptions {
  token: string;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_THREAD_ARCHIVE_DURATIONS = new Set([60, 1440, 4320, 10080]);
const DISCORD_ADMIN_MUTATING_ACTIONS = new Set<DiscordAdminAction>([
  'pin_message',
  'unpin_message',
  'delete_message',
  'add_role',
  'remove_role',
]);

export async function executeDiscordTool(
  input: Record<string, unknown>,
  options: DiscordToolOptions = {},
): Promise<DiscordToolExecutionResult> {
  const action = parseCoreAction(input.action);
  return executeDiscordAction(input, action, options);
}

export async function executeDiscordAdminTool(
  input: Record<string, unknown>,
  options: DiscordToolOptions = {},
): Promise<DiscordToolExecutionResult> {
  const action = parseAdminAction(input.action);
  return executeDiscordAction(input, action, options);
}

async function executeDiscordAction(
  input: Record<string, unknown>,
  action: DiscordAction,
  options: DiscordToolOptions,
): Promise<DiscordToolExecutionResult> {
  const token = options.token ?? process.env.DISCORD_BOT_TOKEN ?? process.env.CODEBUDDY_DISCORD_BOT_TOKEN;
  if (!token?.trim()) {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: 'DISCORD_BOT_TOKEN is required for discord tool access',
    };
  }

  const apiBaseUrl = (options.apiBaseUrl ?? process.env.CODEBUDDY_DISCORD_API_BASE_URL ?? DISCORD_API_BASE).trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: 'fetch is not available in this runtime',
    };
  }

  try {
    if (isDiscordAdminAction(action)) {
      return await executeDiscordAdminAction(action, input, { token, apiBaseUrl, fetchImpl });
    }
    switch (action) {
      case 'fetch_messages':
        return await fetchMessages(input, { token, apiBaseUrl, fetchImpl });
      case 'search_members':
        return await searchMembers(input, { token, apiBaseUrl, fetchImpl });
      case 'create_thread':
        return await createThread(input, { token, apiBaseUrl, fetchImpl });
    }
  } catch (error) {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeDiscordAdminAction(
  action: DiscordAdminAction,
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  enforceAdminAllowlist(action);
  if (DISCORD_ADMIN_MUTATING_ACTIONS.has(action)) {
    requireApproval(input, action);
  }

  switch (action) {
    case 'list_guilds':
      return await listGuilds(context);
    case 'server_info':
      return await serverInfo(input, context);
    case 'list_channels':
      return await listChannels(input, context);
    case 'channel_info':
      return await channelInfo(input, context);
    case 'list_roles':
      return await listRoles(input, context);
    case 'member_info':
      return await memberInfo(input, context);
    case 'list_pins':
      return await listPins(input, context);
    case 'pin_message':
      return await pinMessage(input, context);
    case 'unpin_message':
      return await unpinMessage(input, context);
    case 'delete_message':
      return await deleteMessage(input, context);
    case 'add_role':
      return await addRole(input, context);
    case 'remove_role':
      return await removeRole(input, context);
  }
}

async function fetchMessages(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const limit = normalizeLimit(input.limit, 50);
  const query: Record<string, string> = { limit: String(limit) };
  const before = optionalString(input, 'before');
  const after = optionalString(input, 'after');
  if (before) query.before = before;
  if (after) query.after = after;

  const path = `/channels/${encodeURIComponent(channelId)}/messages`;
  const data = await discordRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
    query,
  });

  const messages = Array.isArray(data) ? data.map(normalizeMessage) : [];
  return okResult('fetch_messages', { messages, count: messages.length }, 'GET', path);
}

async function searchMembers(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const queryText = requiredString(input, 'query');
  const limit = normalizeLimit(input.limit, 20);
  const path = `/guilds/${encodeURIComponent(guildId)}/members/search`;
  const data = await discordRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
    query: {
      query: queryText,
      limit: String(limit),
    },
  });

  const members = Array.isArray(data) ? data.map(normalizeMember) : [];
  return okResult('search_members', { members, count: members.length }, 'GET', path);
}

async function createThread(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const name = requiredString(input, 'name');
  const messageId = optionalString(input, 'message_id');
  const autoArchiveDuration = normalizeArchiveDuration(input.auto_archive_duration);
  const path = messageId
    ? `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`
    : `/channels/${encodeURIComponent(channelId)}/threads`;
  const body: Record<string, unknown> = {
    name,
    auto_archive_duration: autoArchiveDuration,
  };
  if (!messageId) {
    body.type = 11;
  }

  const data = await discordRequest<Record<string, unknown>>({
    ...context,
    method: 'POST',
    path,
    body,
  });

  return okResult(
    'create_thread',
    {
      success: true,
      thread_id: typeof data.id === 'string' ? data.id : undefined,
      name: typeof data.name === 'string' ? data.name : name,
    },
    'POST',
    path,
  );
}

async function listGuilds(
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const path = '/users/@me/guilds';
  const data = await discordRequest<unknown[]>({ ...context, method: 'GET', path });
  const guilds = Array.isArray(data) ? data.map((guild) => {
    const record = asRecord(guild);
    return {
      id: record.id,
      name: record.name,
      icon: record.icon,
      owner: record.owner === true,
      permissions: record.permissions,
    };
  }) : [];
  return okResult('list_guilds', { guilds, count: guilds.length }, 'GET', path);
}

async function serverInfo(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const path = `/guilds/${encodeURIComponent(guildId)}`;
  const data = await discordRequest<Record<string, unknown>>({
    ...context,
    method: 'GET',
    path,
    query: { with_counts: 'true' },
  });
  return okResult('server_info', {
    id: data.id,
    name: data.name,
    description: data.description,
    icon: data.icon,
    owner_id: data.owner_id,
    member_count: data.approximate_member_count,
    online_count: data.approximate_presence_count,
    features: Array.isArray(data.features) ? data.features : [],
    premium_tier: data.premium_tier,
    premium_subscription_count: data.premium_subscription_count,
    verification_level: data.verification_level,
  }, 'GET', path);
}

async function listChannels(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const path = `/guilds/${encodeURIComponent(guildId)}/channels`;
  const data = await discordRequest<unknown[]>({ ...context, method: 'GET', path });
  const channels = Array.isArray(data) ? data.map(normalizeChannel) : [];
  return okResult('list_channels', {
    channels,
    channel_groups: groupChannels(channels),
    total_channels: channels.filter((channel) => channel.type !== 'category').length,
  }, 'GET', path);
}

async function channelInfo(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const path = `/channels/${encodeURIComponent(channelId)}`;
  const data = await discordRequest<Record<string, unknown>>({ ...context, method: 'GET', path });
  return okResult('channel_info', normalizeChannel(data), 'GET', path);
}

async function listRoles(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const path = `/guilds/${encodeURIComponent(guildId)}/roles`;
  const data = await discordRequest<unknown[]>({ ...context, method: 'GET', path });
  const roles = Array.isArray(data)
    ? data.map(normalizeRole).sort((left, right) => numberValue(right.position) - numberValue(left.position))
    : [];
  return okResult('list_roles', { roles, count: roles.length }, 'GET', path);
}

async function memberInfo(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const userId = requiredString(input, 'user_id');
  const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  const data = await discordRequest<Record<string, unknown>>({ ...context, method: 'GET', path });
  return okResult('member_info', normalizeMember(data), 'GET', path);
}

async function listPins(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const path = `/channels/${encodeURIComponent(channelId)}/pins`;
  const data = await discordRequest<unknown[]>({ ...context, method: 'GET', path });
  const pinnedMessages = Array.isArray(data)
    ? data.map((message) => {
      const normalized = normalizeMessage(message);
      return {
        id: normalized.id,
        content: typeof normalized.content === 'string' ? normalized.content.slice(0, 200) : '',
        author: asRecord(normalized.author).username,
        timestamp: normalized.timestamp,
      };
    })
    : [];
  return okResult('list_pins', { pinned_messages: pinnedMessages, count: pinnedMessages.length }, 'GET', path);
}

async function pinMessage(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const messageId = requiredString(input, 'message_id');
  const path = `/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`;
  await discordRequest<unknown>({ ...context, method: 'PUT', path });
  return okResult('pin_message', { success: true, message: `Message ${messageId} pinned.` }, 'PUT', path);
}

async function unpinMessage(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const messageId = requiredString(input, 'message_id');
  const path = `/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`;
  await discordRequest<unknown>({ ...context, method: 'DELETE', path });
  return okResult('unpin_message', { success: true, message: `Message ${messageId} unpinned.` }, 'DELETE', path);
}

async function deleteMessage(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const messageId = requiredString(input, 'message_id');
  const path = `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
  await discordRequest<unknown>({ ...context, method: 'DELETE', path });
  return okResult('delete_message', { success: true, message: `Message ${messageId} deleted.` }, 'DELETE', path);
}

async function addRole(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const userId = requiredString(input, 'user_id');
  const roleId = requiredString(input, 'role_id');
  const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
  await discordRequest<unknown>({ ...context, method: 'PUT', path });
  return okResult('add_role', { success: true, message: `Role ${roleId} added to user ${userId}.` }, 'PUT', path);
}

async function removeRole(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const userId = requiredString(input, 'user_id');
  const roleId = requiredString(input, 'role_id');
  const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
  await discordRequest<unknown>({ ...context, method: 'DELETE', path });
  return okResult('remove_role', { success: true, message: `Role ${roleId} removed from user ${userId}.` }, 'DELETE', path);
}

async function discordRequest<T>(options: DiscordRequestOptions): Promise<T> {
  const url = new URL(options.path, normalizeBaseUrl(options.apiBaseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await options.fetchImpl(url, {
    method: options.method,
    headers: {
      Authorization: `Bot ${options.token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await response.text();
  const body = raw ? parseJson(raw) : null;
  if (!response.ok) {
    const reason = typeof body === 'object' && body && 'message' in body
      ? String((body as { message?: unknown }).message)
      : raw || response.statusText;
    throw new Error(`Discord API error ${response.status}: ${reason}`);
  }
  return body as T;
}

function okResult(
  action: DiscordAction,
  data: unknown,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
): DiscordToolExecutionResult {
  return {
    kind: 'discord_result',
    ok: true,
    action,
    data,
    request: { method, path },
  };
}

function normalizeMessage(message: unknown): Record<string, unknown> {
  const record = asRecord(message);
  const author = asRecord(record.author);
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map((attachment) => {
        const item = asRecord(attachment);
        return {
          filename: item.filename,
          url: item.url,
          size: item.size,
        };
      })
    : [];
  const reactions = Array.isArray(record.reactions)
    ? record.reactions.map((reaction) => {
        const item = asRecord(reaction);
        const emoji = asRecord(item.emoji);
        return {
          emoji: emoji.name,
          count: item.count ?? 0,
        };
      })
    : [];

  return {
    id: record.id,
    content: typeof record.content === 'string' ? record.content : '',
    author: {
      id: author.id,
      username: author.username,
      display_name: author.global_name,
      bot: author.bot === true,
    },
    timestamp: record.timestamp,
    edited_timestamp: record.edited_timestamp,
    attachments,
    reactions,
    pinned: record.pinned === true,
  };
}

function normalizeMember(member: unknown): Record<string, unknown> {
  const record = asRecord(member);
  const user = asRecord(record.user);
  return {
    user_id: user.id,
    username: user.username,
    display_name: user.global_name,
    nickname: record.nick,
    bot: user.bot === true,
    roles: Array.isArray(record.roles) ? record.roles : [],
  };
}

function normalizeChannel(channel: unknown): Record<string, unknown> {
  const record = asRecord(channel);
  return {
    id: record.id,
    name: record.name,
    type: channelTypeName(record.type),
    guild_id: record.guild_id,
    topic: record.topic,
    nsfw: record.nsfw === true,
    position: record.position,
    parent_id: record.parent_id,
    rate_limit_per_user: record.rate_limit_per_user ?? 0,
    last_message_id: record.last_message_id,
  };
}

function groupChannels(channels: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const categories = new Map<string, { id: unknown; name: unknown; position: number; channels: Record<string, unknown>[] }>();
  const uncategorized: Record<string, unknown>[] = [];
  for (const channel of channels) {
    if (channel.type === 'category' && typeof channel.id === 'string') {
      categories.set(channel.id, {
        id: channel.id,
        name: channel.name,
        position: numberValue(channel.position),
        channels: [],
      });
    }
  }
  for (const channel of channels) {
    if (channel.type === 'category') continue;
    const parentId = typeof channel.parent_id === 'string' ? channel.parent_id : undefined;
    const parent = parentId ? categories.get(parentId) : undefined;
    if (parent) {
      parent.channels.push(channel);
    } else {
      uncategorized.push(channel);
    }
  }
  const result: Array<Record<string, unknown>> = [];
  if (uncategorized.length > 0) {
    result.push({ category: null, channels: sortByPosition(uncategorized) });
  }
  for (const category of Array.from(categories.values()).sort((left, right) => left.position - right.position)) {
    result.push({
      category: { id: category.id, name: category.name },
      channels: sortByPosition(category.channels),
    });
  }
  return result;
}

function normalizeRole(role: unknown): Record<string, unknown> {
  const record = asRecord(role);
  const color = numberValue(record.color);
  return {
    id: record.id,
    name: record.name,
    color: color > 0 ? `#${color.toString(16).padStart(6, '0')}` : null,
    position: record.position ?? 0,
    mentionable: record.mentionable === true,
    managed: record.managed === true,
    member_count: record.member_count,
    hoist: record.hoist === true,
  };
}

function parseCoreAction(value: unknown): DiscordCoreAction {
  if (value === 'fetch_messages' || value === 'search_members' || value === 'create_thread') {
    return value;
  }
  throw new Error('action must be one of: fetch_messages, search_members, create_thread');
}

function parseAdminAction(value: unknown): DiscordAdminAction {
  if (isDiscordAdminAction(value)) {
    return value;
  }
  throw new Error('action must be one of: list_guilds, server_info, list_channels, channel_info, list_roles, member_info, list_pins, pin_message, unpin_message, delete_message, add_role, remove_role');
}

function isDiscordAdminAction(value: unknown): value is DiscordAdminAction {
  return value === 'list_guilds'
    || value === 'server_info'
    || value === 'list_channels'
    || value === 'channel_info'
    || value === 'list_roles'
    || value === 'member_info'
    || value === 'list_pins'
    || value === 'pin_message'
    || value === 'unpin_message'
    || value === 'delete_message'
    || value === 'add_role'
    || value === 'remove_role';
}

function enforceAdminAllowlist(action: DiscordAdminAction): void {
  const raw = process.env.CODEBUDDY_DISCORD_ADMIN_ACTIONS ?? process.env.CODEBUDDY_DISCORD_ACTIONS;
  if (!raw?.trim()) return;
  const allowed = new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(action)) {
    throw new Error(`discord_admin action '${action}' is disabled by CODEBUDDY_DISCORD_ADMIN_ACTIONS`);
  }
}

function requireApproval(input: Record<string, unknown>, action: DiscordAdminAction): void {
  if (process.env.CODEBUDDY_DISCORD_ADMIN_ALLOW_MUTATIONS === 'true') return;
  const approvedBy = optionalString(input, 'approved_by');
  if (!approvedBy) {
    throw new Error(`discord_admin ${action} requires approved_by for mutating Discord server actions`);
  }
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('limit must be an integer between 1 and 100');
  }
  return parsed;
}

function normalizeArchiveDuration(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 1440;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !DISCORD_THREAD_ARCHIVE_DURATIONS.has(parsed)) {
    throw new Error('auto_archive_duration must be one of: 60, 1440, 4320, 10080');
  }
  return parsed;
}

function channelTypeName(value: unknown): string {
  const type = Number(value);
  if (type === 0) return 'text';
  if (type === 2) return 'voice';
  if (type === 4) return 'category';
  if (type === 5) return 'announcement';
  if (type === 10) return 'announcement_thread';
  if (type === 11) return 'public_thread';
  if (type === 12) return 'private_thread';
  if (type === 13) return 'stage';
  if (type === 15) return 'forum';
  return `unknown_${Number.isFinite(type) ? type : 'type'}`;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sortByPosition(channels: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...channels].sort((left, right) => numberValue(left.position) - numberValue(right.position));
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
