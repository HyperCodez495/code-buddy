import { logger } from '../utils/logger.js';

export interface OmniParserElement {
  /** Index in the server's parsed_content_list — this is the number drawn on the annotated (SOM) image. */
  id: number;
  /** 'text' | 'icon' (whatever the server reports). */
  type: string;
  /** OCR text or icon caption (the server's `content`). */
  content: string;
  /** Whether OmniParser flagged the element as interactive/clickable (`interactivity`). */
  interactable: boolean;
  /** Bounding box [x1, y1, x2, y2]. Pixels when `normalized` is false, else 0-1 ratios. */
  bbox: [number, number, number, number];
  /** Box center [x, y] — pixels when `normalized` is false. Handy for a follow-up click. */
  center: [number, number];
  /** True when bbox/center are 0-1 ratios (image dimensions were unknown). */
  normalized: boolean;
}

export interface OmniParserResult {
  elements: OmniParserElement[];
  /** Base64 of the Set-of-Marks (numbered) image returned by the server, or the original on failure. */
  annotatedImageBase64: string;
}

export interface ParseScreenOptions {
  /** Screenshot pixel width — when provided, normalized boxes are scaled to pixels. */
  width?: number;
  /** Screenshot pixel height. */
  height?: number;
}

/** Raw item shape from OmniParser v2's `parsed_content_list`. */
interface RawParsedContent {
  type?: string;
  content?: string;
  interactivity?: boolean;
  bbox?: number[];
}

/**
 * Runner for OmniParser (Microsoft's screen-parsing model — github.com/microsoft/OmniParser).
 *
 * Talks to the OmniParser v2 `omniparserserver` FastAPI service (omnitool/omniparserserver):
 *   - POST {base}/parse/  body {"base64_image": "<b64>"}
 *       -> {"som_image_base64": "<b64>", "parsed_content_list": [{type, content, interactivity, bbox}], "latency"}
 *   - GET  {base}/probe/  -> health check
 *
 * `bbox` from the server is normalized to 0-1; we scale it to pixels when the
 * screenshot dimensions are known so the coordinates are directly clickable.
 *
 * The model is GPU/Python and must be self-hosted; configure the base URL via
 * OMNIPARSER_API_URL (default http://localhost:8000). Off-server, every call
 * degrades gracefully to empty elements + the original screenshot.
 */
export class OmniParserRunner {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor() {
    // OMNIPARSER_API_URL is the server base (scheme://host:port); endpoints are derived.
    const raw = process.env.OMNIPARSER_API_URL || 'http://localhost:8000';
    this.baseUrl = raw.replace(/\/+$/, '');
    this.apiKey = process.env.OMNIPARSER_API_KEY;
  }

  private get parseUrl(): string {
    return `${this.baseUrl}/parse/`;
  }

  private get probeUrl(): string {
    return `${this.baseUrl}/probe/`;
  }

  /**
   * Send a base64-encoded screenshot to the OmniParser server for analysis.
   *
   * @param imageBase64 The raw screenshot in base64 (no data: prefix).
   * @param opts Optional screenshot pixel dimensions used to scale normalized boxes.
   * @returns Parsed elements and the annotated (Set-of-Marks) image.
   */
  public async parseScreen(imageBase64: string, opts: ParseScreenOptions = {}): Promise<OmniParserResult> {
    try {
      logger.debug('Sending screenshot to OmniParser API', { url: this.parseUrl });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.parseUrl, {
        method: 'POST',
        headers,
        // OmniParser v2 ParseRequest expects the field `base64_image`.
        body: JSON.stringify({ base64_image: imageBase64 }),
      });

      if (!response.ok) {
        throw new Error(`OmniParser API returned status: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        som_image_base64?: string;
        parsed_content_list?: RawParsedContent[];
      };

      const elements = this.mapElements(data.parsed_content_list ?? [], opts);

      return {
        elements,
        annotatedImageBase64: data.som_image_base64 || imageBase64,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('OmniParser API call failed', { error: msg, url: this.parseUrl });

      // Graceful fallback if the server is down/misconfigured: original image, no elements.
      return {
        elements: [],
        annotatedImageBase64: imageBase64,
      };
    }
  }

  /** Map OmniParser's parsed_content_list into our element shape, scaling boxes to pixels when possible. */
  private mapElements(raw: RawParsedContent[], opts: ParseScreenOptions): OmniParserElement[] {
    const { width, height } = opts;
    const scalable = typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0;

    return raw.map((item, index) => {
      const b = Array.isArray(item.bbox) && item.bbox.length === 4 ? item.bbox : [0, 0, 0, 0];
      let [x1, y1, x2, y2] = [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0, Number(b[3]) || 0];

      if (scalable) {
        x1 = Math.round(x1 * width!);
        y1 = Math.round(y1 * height!);
        x2 = Math.round(x2 * width!);
        y2 = Math.round(y2 * height!);
      }

      return {
        id: index,
        type: item.type ?? 'unknown',
        content: item.content ?? '',
        interactable: item.interactivity ?? false,
        bbox: [x1, y1, x2, y2],
        center: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)],
        normalized: !scalable,
      };
    });
  }

  /**
   * Check if the OmniParser server is reachable via its /probe/ health endpoint.
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(this.probeUrl, { method: 'GET', headers });
      return response.ok;
    } catch {
      return false;
    }
  }
}
