import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 6;
const TRANSFORM: Record<Side, string> = {
  bottom: 'translate(-50%, 0)',
  top: 'translate(-50%, -100%)',
  right: 'translate(0, -50%)',
  left: 'translate(-100%, -50%)',
};

/**
 * A small, styled tooltip — replaces the slow OS-native `title=` popup with an
 * instant, theme-aware pill. Renders into a portal at <body> so it is never
 * clipped by an overflow-hidden ancestor (e.g. the titlebar). Wrap an element:
 *
 *   <Tooltip label="Documentation" side="bottom"><button …/></Tooltip>
 */
export function Tooltip({
  label,
  side = 'bottom',
  className = '',
  children,
}: {
  label: string;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.bottom + GAP;
    if (side === 'top') y = r.top - GAP;
    else if (side === 'left') {
      x = r.left - GAP;
      y = r.top + r.height / 2;
    } else if (side === 'right') {
      x = r.right + GAP;
      y = r.top + r.height / 2;
    }
    timer.current = setTimeout(() => setCoords({ x, y }), 250);
  }, [side]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCoords(null);
  }, []);

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {label && coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium leading-none text-white shadow-lg ring-1 ring-white/10 dark:bg-neutral-700"
            style={{ left: coords.x, top: coords.y, transform: TRANSFORM[side] }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
