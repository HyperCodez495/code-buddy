const DEFAULT_PEER_TOOL_ALLOWLIST = new Set(['view_file', 'list_directory', 'search']);

export function getPeerToolAllowlist(raw = process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST): Set<string> {
  if (!raw) {
    return new Set(DEFAULT_PEER_TOOL_ALLOWLIST);
  }

  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? new Set(items) : new Set(DEFAULT_PEER_TOOL_ALLOWLIST);
}

export function isPeerScopeAllowed(toolName: string, scopes?: string[]): boolean {
  const peerScopes = scopes === undefined ? ['*'] : scopes;
  if (peerScopes.length === 0) {
    return false;
  }

  return peerScopes.some((scope) => {
    return (
      scope === '*'
      || scope === 'all'
      || scope === 'peer:invoke'
      || scope === 'peer:tool:invoke'
      || scope === toolName
      || scope === `tool:${toolName}`
      || scope === 'tool:*'
      || scope === 'tool:all'
    );
  });
}

export function assertPeerToolInvokeAllowed(input: {
  toolName: string;
  scopes?: string[];
  fleetSafe: boolean;
}): void {
  const { toolName, scopes, fleetSafe } = input;

  if (!getPeerToolAllowlist().has(toolName)) {
    throw new Error(
      `TOOL_NOT_ALLOWED_FOR_PEER_INVOKE: tool "${toolName}" is not in the peer-invoke allowlist`,
    );
  }

  if (!fleetSafe) {
    throw new Error(
      `TOOL_NOT_FLEET_SAFE: tool "${toolName}" lacks fleetSafe metadata`,
    );
  }

  if ((scopes ?? ['*']).length === 0) {
    throw new Error('PEER_SCOPE_DENIED: peer has empty scopes list');
  }

  if (!isPeerScopeAllowed(toolName, scopes)) {
    throw new Error(
      `PEER_SCOPE_DENIED: peer scopes [${(scopes ?? ['*']).join(', ')}] do not permit invoking tool "${toolName}"`,
    );
  }
}
