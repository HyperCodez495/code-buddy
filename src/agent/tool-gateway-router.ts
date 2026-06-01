/**
 * Nous Portal "Tool Gateway" routing.
 *
 * When a gateway is configured, outbound calls for web search/extraction
 * (Firecrawl), image/video generation, etc. are routed through the gateway
 * base URL with the gateway user token instead of calling the provider API
 * directly. This is the documented *token / self-hosted* gateway contract
 * (`TOOL_GATEWAY_DOMAIN` / `TOOL_GATEWAY_SCHEME` / `TOOL_GATEWAY_USER_TOKEN`,
 * plus Code Buddy's `CODEBUDDY_NOUS_TOOL_GATEWAY_*` / `NOUS_TOOL_GATEWAY_*`
 * variants and the per-tool `NOUS_MANAGED_TOOLS` allow-set).
 *
 * Deliberately NOT implemented (undocumented upstream → would be fabrication):
 * the Nous-managed OAuth device-code flow. This module only does transparent
 * base-URL + bearer-token substitution against a gateway the operator has
 * configured. Detection here mirrors `hermes-portal-status.ts` so routing and
 * the readiness surface stay consistent.
 */

export type ToolGatewayToolKey = 'web' | 'image_gen' | 'video_gen' | 'tts' | 'browser';

export interface ToolGatewayRoute {
  /** Base URL to use instead of the direct provider endpoint. */
  baseUrl: string;
  /** Gateway user token (raw). Routing only resolves when a token is present. */
  token: string;
  /** Name of the env var that provided the gateway URL (never the value). */
  source: string;
}

function pick(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function gatewayEnabled(env: NodeJS.ProcessEnv, baseUrl: string | undefined): boolean {
  const flag = (pick(env, 'CODEBUDDY_NOUS_TOOL_GATEWAY', 'NOUS_TOOL_GATEWAY') ?? '').toLowerCase();
  return Boolean(baseUrl) || ['1', 'true', 'yes', 'on'].includes(flag);
}

/** Per-tool allow-set, identical semantics to `hermes-portal-status.ts`. */
function managedToolSet(env: NodeJS.ProcessEnv): Set<string> | 'all' {
  const raw = pick(env, 'CODEBUDDY_NOUS_MANAGED_TOOLS', 'NOUS_MANAGED_TOOLS');
  if (!raw) return 'all';
  const values = raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (values.includes('all') || values.includes('*')) return 'all';
  return new Set(values);
}

function toolAliases(toolKey: ToolGatewayToolKey): string[] {
  // `video_gen` shares the `image_gen`/`image` managed bucket upstream.
  if (toolKey === 'video_gen') return ['video_gen', 'video', 'image_gen', 'image'];
  if (toolKey === 'image_gen') return ['image_gen', 'image'];
  return [toolKey];
}

function isManaged(toolKey: ToolGatewayToolKey, env: NodeJS.ProcessEnv): boolean {
  const set = managedToolSet(env);
  if (set === 'all') return true;
  return toolAliases(toolKey).some((alias) => set.has(alias));
}

/** Resolve the shared gateway base URL from any of the supported env forms. */
function sharedGatewayUrl(env: NodeJS.ProcessEnv): { url: string | undefined; source: string } {
  const direct = pick(env, 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL', 'NOUS_TOOL_GATEWAY_URL');
  if (direct) {
    const source = env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL?.trim() ? 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL' : 'NOUS_TOOL_GATEWAY_URL';
    return { url: direct, source };
  }
  // Official self-hosted form: scheme + domain.
  const domain = pick(env, 'TOOL_GATEWAY_DOMAIN');
  if (domain) {
    const scheme = (pick(env, 'TOOL_GATEWAY_SCHEME') ?? 'https').replace(/:\/\/$/, '');
    return { url: `${scheme}://${domain}`, source: 'TOOL_GATEWAY_DOMAIN' };
  }
  return { url: undefined, source: 'none' };
}

function perToolUrl(toolKey: ToolGatewayToolKey, env: NodeJS.ProcessEnv): string | undefined {
  const suffix = toolKey.toUpperCase();
  return pick(env, `CODEBUDDY_NOUS_TOOL_GATEWAY_${suffix}_URL`, `NOUS_TOOL_GATEWAY_${suffix}_URL`);
}

function gatewayToken(env: NodeJS.ProcessEnv): string | null {
  return (
    pick(
      env,
      'CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN',
      'NOUS_TOOL_GATEWAY_USER_TOKEN',
      'TOOL_GATEWAY_USER_TOKEN',
    ) ?? null
  );
}

/**
 * Resolve gateway routing for a tool. Returns null when the gateway is not
 * configured, the tool is not in the managed allow-set, or no base URL is
 * resolvable — in which case callers must fall back to the direct provider.
 */
export function resolveToolGatewayRoute(
  toolKey: ToolGatewayToolKey,
  env: NodeJS.ProcessEnv = process.env,
): ToolGatewayRoute | null {
  const shared = sharedGatewayUrl(env);
  const perTool = perToolUrl(toolKey, env);
  const baseUrl = (perTool ?? shared.url)?.replace(/\/+$/, '');
  if (!baseUrl) return null;
  if (!gatewayEnabled(env, baseUrl)) return null;
  if (!isManaged(toolKey, env)) return null;
  // Gateway routing implies gateway auth. Without a token we must NOT route:
  // otherwise we'd send the direct provider's API key to the gateway host (a
  // credential leak) or advertise a tool as enabled and then fail at call time.
  const token = gatewayToken(env);
  if (!token) return null;
  return {
    baseUrl,
    token,
    source: perTool ? `CODEBUDDY_NOUS_TOOL_GATEWAY_${toolKey.toUpperCase()}_URL` : shared.source,
  };
}

/** True when at least one of the routable tools is gateway-routed. Secret-safe. */
export function isToolGatewayRoutingActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return (['web', 'image_gen', 'video_gen'] as ToolGatewayToolKey[]).some(
    (key) => resolveToolGatewayRoute(key, env) !== null,
  );
}
