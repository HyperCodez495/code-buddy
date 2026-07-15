/**
 * Widgets — rich, self-contained UI components rendered INLINE in a conversation
 * (ChatGPT-Apps-SDK style), driven by a tool's structured `data` payload.
 *
 * A widget is a body fragment (HTML + scoped CSS) rendered entirely on the
 * server. `renderWidgetDocument` wraps the inert fragment in a sandboxed HTML
 * document. Curated widgets ship in-repo; authored ones are safe Mustache
 * templates generated on the fly and reused (see the self-learning engine).
 *
 * @module widgets/widget-types
 */

/** The structured payload a tool emits for a weather widget (aligns with WeatherTool.data). */
export interface WeatherWidgetData {
  type: 'weather';
  location: string;
  current: {
    temperature: number;
    feelsLike?: number;
    condition: string;
    humidity?: number;
    windSpeed?: number;
  };
  forecast?: Array<{ day: string; min: number; max: number; condition: string }>;
  units?: 'metric' | 'imperial';
}

/** The structured payload for a news/headlines widget. */
export interface NewsWidgetData {
  type: 'news';
  title?: string;
  items: Array<{ title: string; url?: string; source?: string }>;
}

/** The structured payload for a stock-market quote widget. */
export interface StockWidgetData {
  type: 'stock' | 'market' | 'bourse';
  symbol?: string;
  name?: string;
  price?: number | string;
  value?: number | string;
  change?: number | string;
  changePercent?: number | string;
  currency?: string;
  market?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  previousClose?: number | string;
  volume?: number | string;
  time?: string;
}

export type WidgetData =
  | WeatherWidgetData
  | NewsWidgetData
  | StockWidgetData
  | { type: string; [k: string]: unknown };

/** The `type` discriminator of a widget payload (also the widget "kind"). */
export function widgetKind(data: unknown): string | null {
  const t = (data as { type?: unknown })?.type;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

/** A candidate authored widget (LLM-proposed), before it clears the gate. */
export interface WidgetProposal {
  /** The data `type` this widget renders. */
  kind: string;
  /** SAFE Mustache-style HTML+CSS template (no script), read by the template engine. */
  template: string;
  /** Sample data the gate renders the template against. */
  sample: unknown;
  /** Optional human-readable brief the proposer was given. */
  brief?: string;
  /** Data discriminators this template may be auto-selected for. */
  dataTypes?: string[];
}

/** One authored widget loaded from the on-disk registry. */
export interface AuthoredWidget {
  kind: string;
  template: string;
  /** Empty for legacy metadata, which deliberately disables auto-matching. */
  dataTypes: string[];
  usedCount: number;
  lastUsedAt: number | null;
  createdAt: number | null;
  brief: string | null;
}

/** Result of running a proposal through the widget gate (fail-closed). */
export interface WidgetGateOutcome {
  accepted: boolean;
  /**
   * Short machine reason on reject: `static-scan` | `render-empty` |
   * `render-unsafe` | `unrendered-tokens` | `no-data-binding` | `hardcoded`.
   */
  reason?: string;
  reasons?: string[];
  /** The rendered sample fragment, present only on accept. */
  fragment?: string;
}
