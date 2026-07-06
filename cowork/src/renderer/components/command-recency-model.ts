export function recordUse(order: readonly string[], id: string, cap = 20): string[] {
  return [id, ...order.filter((existingId) => existingId !== id)].slice(0, Math.max(0, cap));
}

export function rankByRecency<T extends { id: string }>(
  commands: readonly T[],
  recentIds: readonly string[],
): T[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const seen = new Set<string>();
  const ranked: T[] = [];

  for (const id of recentIds) {
    const command = byId.get(id);
    if (command && !seen.has(id)) {
      ranked.push(command);
      seen.add(id);
    }
  }

  for (const command of commands) {
    if (!seen.has(command.id)) {
      ranked.push(command);
      seen.add(command.id);
    }
  }

  return ranked;
}
