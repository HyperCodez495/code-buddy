import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './message/CodeBlock';

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [remarkMath, [remarkGfm, { singleTilde: false }]] as const;

// rehypeKatex must run BEFORE rehypeSanitize so KaTeX output is generated first.
// BUT the default (github) sanitize schema strips KaTeX's MathML tags, `className`
// and inline `style` — which breaks every rendered formula. Extend the schema to
// whitelist KaTeX's HTML+MathML output while keeping the rest sanitized.
const KATEX_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext',
    'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd',
    'munder', 'mover', 'munderover', 'mspace', 'mpadded', 'mphantom', 'menclose',
    'mstyle', 'svg', 'path', 'line', 'g',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className', 'style', 'ariaHidden', 'aria-hidden',
    ],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style'],
    path: ['d'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth', 'style'],
  },
};

const REHYPE_PLUGINS = [
  [rehypeKatex, { throwOnError: false, strict: false }],
  [rehypeSanitize, KATEX_SANITIZE_SCHEMA],
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
