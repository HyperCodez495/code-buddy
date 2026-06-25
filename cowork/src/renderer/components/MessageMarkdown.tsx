import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './message/CodeBlock';

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [remarkMath, [remarkGfm, { singleTilde: false }]] as const;
// rehypeKatex must run BEFORE rehypeSanitize so that KaTeX output is generated
// first, then sanitized — the reverse order strips KaTeX markup before it renders.
const REHYPE_PLUGINS = [
  [rehypeKatex, { throwOnError: false, strict: false }],
  rehypeSanitize,
] as const;

// Default code rendering for EVERY MessageMarkdown context (ThinkingBlock,
// FilePreviewPane, LiveLauncherPanel, …): fenced blocks → CodeBlock (highlight +
// copy + "open as artifact"); inline code → a styled <code>. Callers can still
// override via the `components` prop (e.g. ContentBlockView's file-mention code).
const DEFAULT_COMPONENTS = {
  code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
    const match = /language-([\w+#.-]+)/.exec(className || '');
    if (!match) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-sm" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
  },
};

export interface MessageMarkdownProps {
  normalizedText: string;
  isStreaming?: boolean;
  components?: Record<string, unknown>;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  isStreaming,
  components,
}: MessageMarkdownProps) {
  return (
    <div className="prose-chat max-w-none text-text-primary">
      <ReactMarkdown
        remarkPlugins={
          REMARK_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['remarkPlugins']
        }
        rehypePlugins={
          REHYPE_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']
        }
        components={
          { ...DEFAULT_COMPONENTS, ...components } as Parameters<typeof ReactMarkdown>[0]['components']
        }
      >
        {normalizedText}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
    </div>
  );
});
