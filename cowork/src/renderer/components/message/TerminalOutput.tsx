/**
 * TerminalOutput — Terminal-style output renderer with ANSI color support
 *
 * Renders bash command output with a dark terminal aesthetic,
 * ANSI escape code parsing, and a copy button.
 */
import React, { useMemo, useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

interface TerminalOutputProps {
  command?: string;
  output: string;
  isError?: boolean;
  maxHeight?: number;
}

interface AnsiSpan {
  text: string;
  className: string;
}

const ANSI_COLORS: Record<number, string> = {
  30: 'text-zinc-900', 31: 'text-red-400', 32: 'text-green-400',
  33: 'text-yellow-400', 34: 'text-blue-400', 35: 'text-purple-400',
  36: 'text-cyan-400', 37: 'text-secondary',
  90: 'text-muted-foreground', 91: 'text-red-300', 92: 'text-green-300',
  93: 'text-yellow-300', 94: 'text-blue-300', 95: 'text-purple-300',
  96: 'text-cyan-300', 97: 'text-white',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: 'bg-background', 41: 'bg-red-900/50', 42: 'bg-green-900/50',
  43: 'bg-yellow-900/50', 44: 'bg-blue-900/50', 45: 'bg-purple-900/50',
  46: 'bg-cyan-900/50', 47: 'bg-surface-hover',
};

const ANSI_SGR_PATTERN = '\\u001b\\[([0-9;]*)m';
const ANSI_SGR_STRIP_PATTERN = '\\u001b\\[[0-9;]*m';

// Parse ANSI escape sequences into styled spans
function parseAnsi(text: string): AnsiSpan[] {
  const result: AnsiSpan[] = [];
  const regex = new RegExp(ANSI_SGR_PATTERN, 'g');
  let lastIndex = 0;
  let currentClasses: string[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        text: text.slice(lastIndex, match.index),
        className: currentClasses.join(' '),
      });
    }
    lastIndex = match.index + match[0].length;

    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentClasses = [];
      } else if (code === 1) {
        currentClasses.push('font-bold');
      } else if (code === 2) {
        currentClasses.push('opacity-70');
      } else if (code === 3) {
        currentClasses.push('italic');
      } else if (code === 4) {
        currentClasses.push('underline');
      } else if (ANSI_COLORS[code]) {
        currentClasses = currentClasses.filter((c) => !c.startsWith('text-'));
        currentClasses.push(ANSI_COLORS[code]);
      } else if (ANSI_BG_COLORS[code]) {
        currentClasses = currentClasses.filter((c) => !c.startsWith('bg-'));
        currentClasses.push(ANSI_BG_COLORS[code]);
      }
    }
  }

  if (lastIndex < text.length) {
    result.push({
      text: text.slice(lastIndex),
      className: currentClasses.join(' '),
    });
  }

  return result.length === 0 ? [{ text, className: '' }] : result;
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(ANSI_SGR_STRIP_PATTERN, 'g'), '');
}

export const TerminalOutput: React.FC<TerminalOutputProps> = React.memo(
  ({ command, output, isError, maxHeight = 320 }) => {
    const [copied, setCopied] = useState(false);
    const spans = useMemo(() => parseAnsi(output), [output]);

    const handleCopy = () => {
      navigator.clipboard.writeText(stripAnsi(output));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="mt-1 rounded-lg overflow-hidden border border-border">
        {/* Header */}
        {command && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-background border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal size={12} className="text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate">$ {command}</span>
            </div>
            <button
              onClick={handleCopy}
              className="text-muted-foreground hover:text-secondary transition-colors flex-shrink-0"
              title="Copy output"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        )}

        {/* Output */}
        <div
          className={`overflow-auto bg-zinc-950 p-3 ${isError ? 'border-l-2 border-red-500' : ''}`}
          style={{ maxHeight }}
        >
          <pre className="text-xs font-mono leading-5 text-secondary whitespace-pre-wrap break-all">
            {spans.map((span, i) => (
              <span key={i} className={span.className}>
                {span.text}
              </span>
            ))}
          </pre>
        </div>
      </div>
    );
  }
);

TerminalOutput.displayName = 'TerminalOutput';
