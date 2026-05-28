/**
 * Sidebar Status Panel
 *
 * Toggleable sidebar (Ctrl+B) showing session status:
 * - Model name
 * - Cost tracking
 * - Git branch + changes
 * - MCP server status
 * - Pending todos
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context/theme-context.js';

interface SidebarProps {
  model: string;
  sessionCost: number;
  costLimit: number;
  gitBranch?: string;
  diffCount?: number;
  todoCount?: number;
  mcpServers?: Array<{ name: string; status: 'connected' | 'error' }>;
  visible: boolean;
}

export function Sidebar(props: SidebarProps) {
  const { colors } = useTheme();

  if (!props.visible) return null;

  return (
    <Box flexDirection="column" width={30} borderStyle="round" borderColor={colors.border} paddingX={1}>
      {/* Model section */}
      <Box flexDirection="column">
        <Text bold color={colors.accent}>Model</Text>
        <Text>{props.model}</Text>
      </Box>

      {/* Cost section */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={colors.warning}>Cost</Text>
        <Text>${props.sessionCost.toFixed(4)} / ${props.costLimit}</Text>
      </Box>

      {/* Git section */}
      {props.gitBranch && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.success}>Git</Text>
          <Text>Branch: {props.gitBranch}</Text>
          {props.diffCount !== undefined && <Text>Changes: {props.diffCount} files</Text>}
        </Box>
      )}

      {/* MCP section */}
      {props.mcpServers && props.mcpServers.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.secondary}>MCP</Text>
          {props.mcpServers.map((s, i) => (
            <Text key={i}>{s.status === 'connected' ? '●' : '○'} {s.name}</Text>
          ))}
        </Box>
      )}

      {/* Todos section */}
      {props.todoCount !== undefined && props.todoCount > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.info}>Todos</Text>
          <Text>{props.todoCount} pending</Text>
        </Box>
      )}
    </Box>
  );
}

export type { SidebarProps };

