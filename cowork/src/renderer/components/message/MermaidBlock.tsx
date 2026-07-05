import { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';

// Read Cowork's active theme tokens so the rendered diagram matches the current
// palette (dark / light / ember / genspark / codex / anthropic). Mermaid wants
// concrete colors, not CSS var() references, so we resolve them here.
function readThemeVariables(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const t = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const surface = t('--color-surface', '#2d2d2d');
  const border = t('--color-border', '#404040');
  const textPrimary = t('--color-text-primary', '#e5e5e5');
  const muted = t('--color-text-muted', '#737373');
  return {
    background: t('--color-surface-muted', '#1e1e1e'),
    primaryColor: surface,
    primaryTextColor: textPrimary,
    primaryBorderColor: border,
    secondaryColor: t('--color-surface-hover', '#333333'),
    tertiaryColor: t('--color-surface-active', '#3e3e42'),
    lineColor: muted,
    textColor: textPrimary,
    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: textPrimary,
    clusterBkg: t('--color-surface-muted', '#1e1e1e'),
    clusterBorder: border,
    edgeLabelBackground: surface,
    titleColor: textPrimary,
  };
}

/**
 * Renders a ```mermaid fenced block as an inline SVG diagram. Ported from the
 * code-explorer chat-ui recipe: dynamic import (keeps the ~500KB lib out of the
 * initial bundle) → initialize (securityLevel strict) → render → DOMPurify → SVG.
 * On failure it keeps the raw source visible so nothing is lost.
 */
export function MermaidBlock({ text }: { text: string }) {
  const reactId = useId();
  const svgId = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: readThemeVariables(),
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          securityLevel: 'strict',
          flowchart: { curve: 'basis', padding: 18, useMaxWidth: true },
        });
        const { svg: rendered } = await mermaid.render(svgId, text.trim());
        if (cancelled) return;
        const clean = DOMPurify.sanitize(rendered, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['foreignObject'],
        });
        setSvg(clean);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setSvg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, svgId]);

  if (error) {
    return (
      <div className="my-2">
        <div className="text-xs text-error mb-1">Diagramme non rendu : {error}</div>
        <pre className="text-xs bg-surface-muted rounded-lg p-3 overflow-x-auto">
          <code>{text}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="my-2 text-xs text-text-muted">Rendu du diagramme…</div>;
  }

  return (
    <div
      className="mermaid-diagram my-3 flex justify-center overflow-x-auto rounded-lg bg-surface-muted p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
