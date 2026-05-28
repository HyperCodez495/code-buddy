import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../context/theme-context.js';

interface ReasoningBlockProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * Collapsible block that displays model reasoning/thinking content.
 * Shows a dimmed "Thinking..." header with the reasoning text below.
 * Can be toggled with 't' key when not in streaming mode.
 */
export function ReasoningBlock({ content, isStreaming = false }: ReasoningBlockProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  useInput((input) => {
    if (input === 't' && !isStreaming) {
      setCollapsed(prev => !prev);
    }
  });

  const lines = content.split('\n');
  const previewLength = 2;
  const hasMore = lines.length > previewLength;

  // Modern collapse symbols
  const arrowSymbol = collapsed ? '⏵' : '⏷';

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box flexDirection="row" alignItems="center">
        <Text color={colors.textMuted} bold>
          {arrowSymbol} 🧠 Thinking{isStreaming ? '...' : ` (${lines.length} lines)`}
        </Text>
        {!isStreaming && hasMore && (
          <Text color={colors.textMuted} dimColor>
            {' '}• [press <Text color={colors.accent}>t</Text> to {collapsed ? 'expand' : 'collapse'}]
          </Text>
        )}
      </Box>
      {!collapsed && (
        <Box paddingLeft={1} flexDirection="column" marginTop={1}>
          {lines.map((line, idx) => (
            <Box key={idx} flexDirection="row">
              <Text color={colors.border}>┊ </Text>
              <Text color={colors.textMuted} italic>
                {line}
              </Text>
            </Box>
          ))}
          {isStreaming && (
            <Box flexDirection="row">
              <Text color={colors.border}>┊ </Text>
              <Text color={colors.accent}>▋</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

