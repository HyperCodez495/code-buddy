/**
 * Accessible Output Components
 *
 * Provides semantic structure and accessibility features for terminal output.
 * Designed to work well with screen readers and provide text alternatives.
 */

import React from "react";
import { Box, Text } from "ink";

/**
 * Section header with semantic level
 * Creates consistent visual and semantic structure
 */
interface SectionHeaderProps {
  text: string;
  level?: 1 | 2 | 3;
  color?: string;
}

export function SectionHeader({ text, level = 1, color = "cyan" }: SectionHeaderProps) {
  const prefix = level === 1 ? "══" : level === 2 ? "──" : "••";
  const suffix = level === 1 ? "══" : level === 2 ? "──" : "";
  const separator = level === 1 ? "═" : level === 2 ? "─" : "";
  const separatorLength = level === 1 ? 40 : level === 2 ? 30 : 0;

  return (
    <Box flexDirection="column" marginY={level === 1 ? 1 : 0}>
      <Text color={color} bold={level === 1}>
        {prefix} {text} {suffix}
      </Text>
      {separatorLength > 0 && (
        <Text color={color} dimColor>
          {separator.repeat(separatorLength)}
        </Text>
      )}
    </Box>
  );
}

/**
 * Status indicator with text label
 * Never uses color alone to convey meaning
 */
interface StatusWithTextProps {
  status: "success" | "error" | "warning" | "info" | "pending" | "running";
  text: string;
  showLabel?: boolean;
}

const STATUS_CONFIG = {
  success: { icon: "✓", color: "green", label: "[SUCCESS]" },
  error: { icon: "✗", color: "red", label: "[ERROR]" },
  warning: { icon: "⚠", color: "yellow", label: "[WARNING]" },
  info: { icon: "ℹ", color: "blue", label: "[INFO]" },
  pending: { icon: "○", color: "gray", label: "[PENDING]" },
  running: { icon: "◐", color: "cyan", label: "[RUNNING]" },
};

export function StatusWithText({
  status,
  text,
  showLabel = true,
}: StatusWithTextProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box>
      <Text color={config.color}>{config.icon} </Text>
      {showLabel && <Text color={config.color}>{config.label} </Text>}
      <Text>{text}</Text>
    </Box>
  );
}

/**
 * Progress with text description
 * Provides both visual and textual progress indication
 */
interface AccessibleProgressProps {
  current: number;
  total: number;
  label: string;
  showBar?: boolean;
  showPercentage?: boolean;
  width?: number;
}

export function AccessibleProgress({
  current,
  total,
  label,
  showBar = true,
  showPercentage = true,
  width = 20,
}: AccessibleProgressProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const filledWidth = Math.round((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{label}: </Text>
        <Text bold>
          {current} of {total}
        </Text>
        {showPercentage && <Text dimColor> ({percentage}%)</Text>}
      </Box>
      {showBar && (
        <Box marginLeft={2}>
          <Text color="green">{"█".repeat(filledWidth)}</Text>
          <Text dimColor>{"░".repeat(emptyWidth)}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Keyboard shortcut display
 * Clearly shows key combinations
 */
interface KeyboardShortcutProps {
  keys: string[];
  description: string;
}

export function KeyboardShortcut({ keys, description }: KeyboardShortcutProps) {
  return (
    <Box>
      {keys.map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 && <Text dimColor> + </Text>}
          <Text backgroundColor="gray" color="white">
            {" "}
            {key}{" "}
          </Text>
        </React.Fragment>
      ))}
      <Text> {description}</Text>
    </Box>
  );
}

/**
 * Help panel with keyboard shortcuts
 */
interface HelpPanelProps {
  shortcuts: Array<{ keys: string[]; description: string }>;
  title?: string;
}

export function HelpPanel({ shortcuts, title = "Keyboard Shortcuts" }: HelpPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      <SectionHeader text={title} level={2} />
      <Box flexDirection="column" marginTop={1}>
        {shortcuts.map((shortcut, index) => (
          <KeyboardShortcut
            key={index}
            keys={shortcut.keys}
            description={shortcut.description}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Accessible list with proper numbering
 */
interface AccessibleListProps {
  items: string[];
  ordered?: boolean;
  bulletChar?: string;
}

export function AccessibleList({
  items,
  ordered = false,
  bulletChar = "•",
}: AccessibleListProps) {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={index}>
          <Text dimColor>
            {ordered ? `${index + 1}.` : bulletChar}{" "}
          </Text>
          <Text>{item}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Definition list for key-value pairs
 */
interface DefinitionListProps {
  items: Array<{ term: string; definition: string }>;
}

export function DefinitionList({ items }: DefinitionListProps) {
  const maxTermLength = Math.max(...items.map((i) => i.term.length));

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={index}>
          <Text bold>{item.term.padEnd(maxTermLength)}</Text>
          <Text dimColor> : </Text>
          <Text>{item.definition}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Announcement for screen readers
 * Important messages that should be announced
 */
interface AnnouncementProps {
  message: string;
  type?: "polite" | "assertive";
  prefix?: string;
}

export function Announcement({
  message,
  type = "polite",
  prefix,
}: AnnouncementProps) {
  const icon = type === "assertive" ? "⚡" : "📢";
  const color = type === "assertive" ? "yellow" : "cyan";

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      {prefix && <Text bold>[{prefix}] </Text>}
      <Text>{message}</Text>
    </Box>
  );
}

/**
 * Error message with structured format
 */
interface AccessibleErrorProps {
  code?: string;
  message: string;
  details?: string;
  suggestion?: string;
  docUrl?: string;
}

export function AccessibleError({
  code,
  message,
  details,
  suggestion,
  docUrl,
}: AccessibleErrorProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
      <Box>
        <Text color="red">✗ [ERROR] </Text>
        <Text bold>{message}</Text>
      </Box>

      {code && (
        <Box marginTop={1}>
          <Text dimColor>Code: </Text>
          <Text>{code}</Text>
        </Box>
      )}

      {details && (
        <Box marginTop={1}>
          <Text dimColor>Details: </Text>
          <Text>{details}</Text>
        </Box>
      )}

      {suggestion && (
        <Box marginTop={1}>
          <Text color="yellow">💡 Suggestion: </Text>
          <Text>{suggestion}</Text>
        </Box>
      )}

      {docUrl && (
        <Box marginTop={1}>
          <Text dimColor>📚 Documentation: </Text>
          <Text color="cyan">{docUrl}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Success message with structured format
 */
interface AccessibleSuccessProps {
  message: string;
  details?: string[];
}

export function AccessibleSuccess({ message, details }: AccessibleSuccessProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">✓ [SUCCESS] </Text>
        <Text>{message}</Text>
      </Box>

      {details && details.length > 0 && (
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {details.map((detail, index) => (
            <Text key={index} dimColor>
              • {detail}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Table with accessible headers
 */
interface AccessibleTableProps {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export function AccessibleTable({ headers, rows, caption }: AccessibleTableProps) {
  const colWidths = headers.map((header, i) =>
    Math.max(
      header.length,
      ...rows.map((row) => (row[i] || "").length)
    )
  );

  const formatCell = (content: string, width: number) =>
    content.padEnd(width);

  const separator = colWidths.map((w) => "─".repeat(w)).join("─┼─");

  return (
    <Box flexDirection="column">
      {caption && (
        <Text bold dimColor>
          Table: {caption}
        </Text>
      )}
      <Text bold>
        {headers.map((h, i) => formatCell(h, colWidths[i] ?? 0)).join(" │ ")}
      </Text>
      <Text dimColor>{separator}</Text>
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {row.map((cell, i) => formatCell(cell || "", colWidths[i] ?? 0)).join(" │ ")}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Code block with language indicator
 */
interface AccessibleCodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export function AccessibleCodeBlock({
  code,
  language,
  showLineNumbers = false,
}: AccessibleCodeBlockProps) {
  const lines = code.split("\n");
  const lineNumberWidth = String(lines.length).length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      {language && (
        <Box marginBottom={1}>
          <Text backgroundColor="gray" color="white">
            {" "}
            {language}{" "}
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Box key={index}>
            {showLineNumbers && (
              <Text dimColor>
                {String(index + 1).padStart(lineNumberWidth)} │{" "}
              </Text>
            )}
            <Text>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Divider with optional label
 */
interface DividerProps {
  label?: string;
  width?: number;
  color?: string;
}

export function Divider({ label, width = 40, color = "gray" }: DividerProps) {
  if (!label) {
    return <Text color={color}>{"─".repeat(width)}</Text>;
  }

  const sideWidth = Math.floor((width - label.length - 2) / 2);
  return (
    <Text color={color}>
      {"─".repeat(sideWidth)} {label} {"─".repeat(width - sideWidth - label.length - 2)}
    </Text>
  );
}

export default {
  SectionHeader,
  StatusWithText,
  AccessibleProgress,
  KeyboardShortcut,
  HelpPanel,
  AccessibleList,
  DefinitionList,
  Announcement,
  AccessibleError,
  AccessibleSuccess,
  AccessibleTable,
  AccessibleCodeBlock,
  Divider,
};
