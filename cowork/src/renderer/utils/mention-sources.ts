/**
 * mention-sources — P4.6
 *
 * Extra @-mention sources beyond the workspace file list. Each function
 * returns a Promise of MentionItem-shaped suggestions. Use sparingly —
 * each call hits its bridge once when the autocomplete opens.
 */

export interface MentionSourceItem {
  id: string;
  value: string;
  label: string;
  description?: string;
  kind: 'file' | 'persona' | 'agent' | 'memory' | 'skill' | 'mcp-tool' | 'peer';
}

export async function listPersonas(): Promise<MentionSourceItem[]> {
  try {
    const api = (window.electronAPI as unknown as { identity?: { list?: () => Promise<Array<{ id: string; name: string; description?: string }>> } })?.identity?.list;
    if (!api) return [];
    const list = await api();
    return list.map((p) => ({
      id: `persona:${p.id}`,
      value: `@persona:${p.id}`,
      label: p.name,
      description: p.description,
      kind: 'persona' as const,
    }));
  } catch {
    return [];
  }
}

export async function listAgents(): Promise<MentionSourceItem[]> {
  try {
    const api = (window.electronAPI as unknown as { team?: { listMembers?: () => Promise<Array<{ id: string; nickname?: string; role: string }>> } })?.team?.listMembers;
    if (!api) return [];
    const list = await api();
    return list.map((a) => ({
      id: `agent:${a.id}`,
      value: `@agent:${a.id}`,
      label: a.nickname ?? a.id,
      description: a.role,
      kind: 'agent' as const,
    }));
  } catch {
    return [];
  }
}

export async function listSkills(prefix: string): Promise<MentionSourceItem[]> {
  try {
    const api = (window.electronAPI as unknown as { skillMd?: { search?: (q: string) => Promise<Array<{ name: string; description?: string }>> } })?.skillMd?.search;
    if (!api) return [];
    const list = await api(prefix);
    return list.map((s) => ({
      id: `skill:${s.name}`,
      value: `@skill:${s.name}`,
      label: s.name,
      description: s.description,
      kind: 'skill' as const,
    }));
  } catch {
    return [];
  }
}

export async function listMcpTools(): Promise<MentionSourceItem[]> {
  try {
    const api = window.electronAPI?.mcp?.listAllTools;
    if (!api) return [];
    const list = (await api()) as Array<{ id?: string; name: string; description?: string }>;
    return list.map((t) => ({
      id: `mcp:${t.id ?? t.name}`,
      value: `@mcp:${t.name}`,
      label: t.name,
      description: t.description,
      kind: 'mcp-tool' as const,
    }));
  } catch {
    return [];
  }
}

export async function listPeers(): Promise<MentionSourceItem[]> {
  try {
    const api = (window.electronAPI as unknown as { fleet?: { listPeers?: () => Promise<Array<{ id: string; label?: string; url?: string }>> } })?.fleet?.listPeers;
    if (!api) return [];
    const list = await api();
    return list.map((p) => ({
      id: `peer:${p.id}`,
      value: `@peer:${p.id}`,
      label: p.label ?? p.id,
      description: p.url,
      kind: 'peer' as const,
    }));
  } catch {
    return [];
  }
}

export async function listMemoryEntries(prefix: string): Promise<MentionSourceItem[]> {
  try {
    const api = (window.electronAPI as unknown as { memory?: { search?: (q: string) => Promise<Array<{ id: string; preview: string }>> } })?.memory?.search;
    if (!api) return [];
    const list = await api(prefix);
    return list.map((m) => ({
      id: `memory:${m.id}`,
      value: `@memory:${m.id}`,
      label: m.preview.slice(0, 60),
      kind: 'memory' as const,
    }));
  } catch {
    return [];
  }
}

export async function collectExtendedMentions(prefix: string): Promise<MentionSourceItem[]> {
  // Parallel fetch — limit to non-empty sources.
  const [personas, agents, skills, mcp, peers, memory] = await Promise.all([
    listPersonas(),
    listAgents(),
    listSkills(prefix),
    listMcpTools(),
    listPeers(),
    listMemoryEntries(prefix),
  ]);
  const all = [...personas, ...agents, ...skills, ...mcp, ...peers, ...memory];
  if (!prefix) return all.slice(0, 20);
  const q = prefix.toLowerCase();
  return all
    .filter((m) => m.label.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q))
    .slice(0, 20);
}
