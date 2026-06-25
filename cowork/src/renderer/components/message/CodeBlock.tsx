// Fenced code block with syntax highlighting (highlight.js), a copy button, and
// — for previewable code (html/svg/mermaid/react) — an "open as live artifact" button.
import { useState, useMemo, memo } from 'react';
import { Copy, Check, Eye } from 'lucide-react';
import hljs from 'highlight.js';
import { useAppStore } from '../../store';
import { detectKind, simpleHash, inferTitle } from '../../utils/artifact-detector';

// Sanitize highlight.js output - only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(/<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

interface CodeBlockProps {
  language: string;
  children: string;
}

export const CodeBlock = memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);

  // If this block is a previewable kind (html/svg/mermaid/react/json), build the
  // artifact descriptor so we can offer an "open as live preview" button.
  const artifact = useMemo(() => {
    const kind = detectKind(language, children);
    if (!kind) return null;
    return {
      id: simpleHash(`${kind}:${children}`),
      kind,
      language: language || kind,
      source: children,
      title: inferTitle(kind, children),
    };
  }, [language, children]);

  const highlightedHtml = useMemo(() => {
    try {
      const lang = language.toLowerCase();
      let result: string;
      if (hljs.getLanguage(lang)) {
        result = hljs.highlight(children, { language: lang }).value;
      } else {
        result = hljs.highlightAuto(children).value;
      }
      return sanitizeHighlight(result);
    } catch {
      return null;
    }
  }, [children, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail if focus is lost or permission denied
    }
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">{language}</span>
        {artifact && (
          <button
            onClick={() => setActiveArtifact(artifact)}
            aria-label="Open live preview"
            title="Open live preview"
            className="w-7 h-7 flex items-center justify-center rounded bg-surface hover:bg-surface-hover transition-colors"
          >
            <Eye className="w-3.5 h-3.5 text-text-muted" />
          </button>
        )}
        <button
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy'}
          className="w-7 h-7 flex items-center justify-center rounded bg-surface hover:bg-surface-hover transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>
      </div>
      <pre className="code-block">
        {highlightedHtml ? (
          // highlight.js sanitizes and escapes input before injecting span tokens
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
});
