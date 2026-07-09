import { memo, useEffect, useRef, useState } from 'react';

interface WidgetBlockProps {
  data: unknown;
  className?: string;
}

function isWidgetCandidate(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

/**
 * Detect the HOST (Cowork) theme so the widget matches it — the OS
 * `prefers-color-scheme` inside the iframe is NOT the app theme. We read the
 * luminance of the app's background; dark app ⇒ 'dark'. Falls back to 'dark'
 * (Cowork's default) when it can't be measured.
 */
function detectHostTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'dark';
  try {
    const root = document.querySelector('main, [data-theme], body') ?? document.body;
    const bg = getComputedStyle(root as Element).backgroundColor;
    const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return 'dark';
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5 ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export const WidgetBlock = memo(function WidgetBlock({ data, className = '' }: WidgetBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number | '100%'; h: number }>({ w: '100%', h: 132 });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    if (!isWidgetCandidate(data) || typeof window === 'undefined') return;
    const render = window.electronAPI?.widgets?.render;
    if (!render) return;

    void render(data, detectHostTheme())
      .then((nextHtml) => {
        if (!cancelled) setHtml(nextHtml);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  // Auto-size the iframe to HUG the widget card exactly — no fixed height/width,
  // so there's no empty gap around it. The iframe is `allow-same-origin` WITHOUT
  // `allow-scripts`, so we can measure the (script-free, server-rendered) content
  // while no script can ever execute inside it.
  const measure = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const root = doc.querySelector('body > *:not(style):not(script)') as HTMLElement | null;
    const rect = root?.getBoundingClientRect();
    const h = Math.ceil(rect?.height || doc.documentElement?.scrollHeight || 0);
    const w = Math.ceil(rect?.width || 0);
    if (h > 0) setSize({ h, w: w > 0 ? w : '100%' });
  };

  if (!html) return null;

  return (
    <div className={`max-w-full overflow-hidden rounded-xl ${className}`}>
      <iframe
        ref={iframeRef}
        title="tool-result-widget"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={html}
        onLoad={measure}
        className="block border-0 bg-transparent"
        style={{ height: size.h, width: size.w, maxWidth: '100%' }}
      />
    </div>
  );
});
