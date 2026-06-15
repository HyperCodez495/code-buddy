/**
 * SchemaTree — collapsible tree for the NDV Schema view (Vague 2 — gap U2).
 *
 * Each row shows key, type badge, truncated preview. Object/array rows expand
 * on chevron click. Right-click opens a "Copy path" menu yielding the full
 * `$json.…` path. Each row is also draggable so it can be dropped into an
 * ExpressionEditor (drag-to-express, Phase 3.2).
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';

export interface SchemaTreeProps {
  data: unknown;
  /** Root prefix for generated paths. Defaults to `$json`. */
  rootPath?: string;
  /** Optional click-to-copy hook (defaults to navigator.clipboard). */
  onCopyPath?: (path: string) => void;
  /** Optional drag-start hook. */
  onDragStart?: (path: string, event: React.DragEvent) => void;
  /** Auto-expand the first N rows (default 50). */
  autoExpandLimit?: number;
}

interface FlatRow {
  key: string;
  /** Full path like `$json.user.profile.email` */
  path: string;
  type: string;
  preview: string;
  depth: number;
  isContainer: boolean;
}

const isValidIdentifier = (k: string) => /^[A-Za-z_$][\w$]*$/.test(k);

// eslint-disable-next-line react-refresh/only-export-components
export function buildPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return isValidIdentifier(key) ? `${parent}.${key}` : `${parent}["${key.replace(/"/g, '\\"')}"]`;
}

function describeValue(v: unknown): { type: string; preview: string; isContainer: boolean } {
  if (v === null) return { type: 'null', preview: 'null', isContainer: false };
  if (v === undefined) return { type: 'undefined', preview: '—', isContainer: false };
  if (Array.isArray(v)) return { type: `array(${v.length})`, preview: `[${v.length}]`, isContainer: v.length > 0 };
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    return { type: 'object', preview: `{${keys.length}}`, isContainer: keys.length > 0 };
  }
  if (typeof v === 'string') {
    const s = v.length > 60 ? v.slice(0, 60) + '…' : v;
    return { type: 'string', preview: `"${s}"`, isContainer: false };
  }
  return { type: typeof v, preview: String(v), isContainer: false };
}

/** Walk `data` and emit one row per key, honoring `expanded` set for containers. */
function flatten(
  data: unknown,
  rootPath: string,
  expanded: Set<string>,
  out: FlatRow[] = [],
  key: string = 'root',
  depth: number = 0
): FlatRow[] {
  const path = depth === 0 ? rootPath : key;
  const desc = describeValue(data);
  out.push({ key, path, type: desc.type, preview: desc.preview, depth, isContainer: desc.isContainer });
  if (!desc.isContainer || !expanded.has(path)) return out;

  if (Array.isArray(data)) {
    // Show first 100 children; collapse rest behind a placeholder row.
    const limit = Math.min(data.length, 100);
    for (let i = 0; i < limit; i++) {
      const childPath = buildPath(path, i);
      flatten(data[i], rootPath, expanded, out, childPath, depth + 1);
    }
    if (data.length > limit) {
      out.push({
        key: '…',
        path: path + '__more',
        type: `(+${data.length - limit} more)`,
        preview: '',
        depth: depth + 1,
        isContainer: false,
      });
    }
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const childPath = buildPath(path, k);
      flatten(v, rootPath, expanded, out, childPath, depth + 1);
    }
  }
  return out;
}

const SchemaTree: React.FC<SchemaTreeProps> = ({
  data,
  rootPath = '$json',
  onCopyPath,
  onDragStart,
  autoExpandLimit = 50,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Auto-expand top-level keys when data is small, for quick scanning.
  useEffect(() => {
    if (data && typeof data === 'object') {
      const next = new Set([rootPath]);
      const top = Array.isArray(data) ? data.slice(0, 1) : Object.entries(data as Record<string, unknown>);
      if (top.length <= autoExpandLimit) {
        if (Array.isArray(data) && data.length > 0) next.add(buildPath(rootPath, 0));
      }
      setExpanded(next);
    }
  }, [data, rootPath, autoExpandLimit]);

  const rows = useMemo(() => flatten(data, rootPath, expanded), [data, rootPath, expanded]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const copy = useCallback(
    async (path: string) => {
      const expr = `={{ ${path} }}`;
      if (onCopyPath) {
        onCopyPath(expr);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(expr);
        } catch {
          // Best effort — clipboard may be denied in tests/headless.
        }
      }
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((p) => (p === path ? null : p)), 1200);
      setMenu(null);
    },
    [onCopyPath]
  );

  // Inline copy: writes the n8n expression form `{{ $json.foo.bar }}` (no `=` prefix)
  // — used by the per-row hover button. The right-click menu still uses the
  // legacy `={{ … }}` form so n8n recognises the value as a full expression.
  const copyInline = useCallback(
    async (path: string) => {
      const expr = `{{ ${path} }}`;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(expr);
        } catch {
          // Best effort — clipboard may be denied in tests/headless.
        }
      }
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((p) => (p === path ? null : p)), 1200);
    },
    []
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, path: string) => {
      const expr = `={{ ${path} }}`;
      e.dataTransfer.setData('text/plain', expr);
      e.dataTransfer.setData('application/x-expression', path);
      e.dataTransfer.effectAllowed = 'copy';
      onDragStart?.(path, e);
    },
    [onDragStart]
  );

  // Dismiss the menu on outside click.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close, { once: true });
    return () => window.removeEventListener('click', close);
  }, [menu]);

  return (
    <div className="leading-5 text-xs font-mono select-text" data-testid="schema-tree">
      {rows.map((row) => {
        const isRoot = row.depth === 0;
        const isPlaceholder = row.path.endsWith('__more');
        const showCopyButton = !isRoot && !isPlaceholder;
        const isCopied = copiedPath === row.path;
        return (
          <div
            key={row.path}
            data-path={row.path}
            draggable={!isRoot && !isPlaceholder}
            onDragStart={(e) => handleDragStart(e, row.path)}
            onContextMenu={(e) => !isRoot && handleContextMenu(e, row.path)}
            className="group flex items-center gap-1 hover:bg-[var(--surface-hover,_rgba(255,255,255,0.04))] cursor-default"
            style={{ paddingLeft: row.depth * 12 }}
          >
            {row.isContainer ? (
              <button
                type="button"
                onClick={() => toggle(row.path)}
                aria-label={expanded.has(row.path) ? 'Collapse' : 'Expand'}
                className="w-4 text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {expanded.has(row.path) ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="text-[var(--text-muted)]">{row.key}</span>
            <span className="ml-1 text-[var(--primary)]">{row.type}</span>
            {row.preview && row.preview !== row.type && (
              <span className="ml-2 text-[var(--text-muted)] truncate max-w-[40ch]">{row.preview}</span>
            )}
            {showCopyButton && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyInline(row.path);
                }}
                aria-label={`Copy expression for ${row.path}`}
                title={`Copy {{ ${row.path} }}`}
                data-testid={`schema-tree-copy-${row.path}`}
                className={
                  'ml-auto inline-flex items-center justify-center w-5 h-5 rounded ' +
                  'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover,_rgba(255,255,255,0.08))] ' +
                  (isCopied
                    ? 'opacity-100 text-[var(--success,_#22c55e)]'
                    : 'opacity-0 group-hover:opacity-100 focus:opacity-100')
                }
              >
                {isCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              </button>
            )}
          </div>
        );
      })}

      {menu && (
        <div
          role="menu"
          style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 1000 }}
          className="bg-[var(--surface,_#1f2937)] border border-[var(--border,_#374151)] shadow-lg rounded text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="block px-3 py-1.5 text-left w-full hover:bg-[var(--surface-hover,_rgba(255,255,255,0.06))]"
            onClick={() => copy(menu.path)}
          >
            Copy path
          </button>
          <button
            type="button"
            role="menuitem"
            className="block px-3 py-1.5 text-left w-full hover:bg-[var(--surface-hover,_rgba(255,255,255,0.06))]"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(menu.path).catch(() => {});
              }
              setMenu(null);
            }}
          >
            Copy path (raw)
          </button>
        </div>
      )}
    </div>
  );
};

export default SchemaTree;
