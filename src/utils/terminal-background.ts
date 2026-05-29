/**
 * Terminal Background Auto-Detection
 *
 * Detects whether the terminal has a dark or light background
 * using the OSC 11 escape sequence to query the background color.
 * Falls back to environment variable heuristics.
 */

export type TerminalBackground = 'dark' | 'light' | 'unknown';

/**
 * Detect terminal background color using OSC 11 query.
 * Only works on real TTYs that support OSC 11 responses.
 * Falls back to environment variable heuristics.
 */
export async function detectTerminalBackground(): Promise<TerminalBackground> {
  // Check environment variable overrides first
  const colorFors = process.env.COLORFGBG;
  if (colorFors) {
    // COLORFGBG is "fg;bg" — bg >= 8 typically means dark
    const parts = colorFors.split(';');
    const bgRaw = parts[parts.length - 1];
    const bg = bgRaw !== undefined ? parseInt(bgRaw, 10) : NaN;
    if (!isNaN(bg)) {
      return bg < 8 ? 'dark' : 'light';
    }
  }

  // Check common terminal-type hints
  const _term = process.env.TERM_PROGRAM?.toLowerCase() || '';
  const isDarkHint = process.env.DARK_MODE === '1' || process.env.CODEBUDDY_THEME === 'dark';
  const isLightHint = process.env.DARK_MODE === '0' || process.env.CODEBUDDY_THEME === 'light';
  if (isDarkHint) return 'dark';
  if (isLightHint) return 'light';

  // Only try OSC 11 on real TTYs
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return 'unknown';
  }

  return new Promise<TerminalBackground>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve('unknown');
    }, 500);

    let buffer = '';

    const cleanup = () => {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
      } catch {
        // Ignore cleanup errors
      }
    };

    const onData = (data: Buffer) => {
      buffer += data.toString();
      // Look for OSC 11 response: ESC ] 11 ; rgb:RRRR/GGGG/BBBB ST
      // eslint-disable-next-line no-control-regex
      const match = buffer.match(/\x1b\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i);
      // The three capture groups are mandatory, so they are all defined when `match` is truthy.
      if (match && match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
        cleanup();
        // Parse color components — first 2 hex chars of each (they may be 2 or 4 digits)
        const r = parseInt(match[1].slice(0, 2), 16) / 255;
        const g = parseInt(match[2].slice(0, 2), 16) / 255;
        const b = parseInt(match[3].slice(0, 2), 16) / 255;
        // Relative luminance (sRGB)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        resolve(luminance > 0.5 ? 'light' : 'dark');
      }
    };

    try {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
      // Send OSC 11 query — BEL terminator (works in more terminals than ST)
      process.stdout.write('\x1b]11;?\x07');
    } catch {
      cleanup();
      resolve('unknown');
    }
  });
}

// Cache the result after first detection
let cachedBackground: TerminalBackground | null = null;

/**
 * Get terminal background, caching the result.
 * Call resetTerminalBackgroundCache() to force re-detection.
 */
export async function getTerminalBackground(): Promise<TerminalBackground> {
  if (cachedBackground !== null) return cachedBackground;
  cachedBackground = await detectTerminalBackground();
  return cachedBackground;
}

/**
 * Reset the cached terminal background detection.
 * Useful for testing or when the terminal environment changes.
 */
export function resetTerminalBackgroundCache(): void {
  cachedBackground = null;
}
