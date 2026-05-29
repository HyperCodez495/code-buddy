/**
 * UI Enhancements
 *
 * BrailleSpinner: animated braille spinner with shimmer effect
 * CJKInputHandler: full-width character normalization and display width
 * ITermProgressBar: iTerm2 native progress bar via escape codes
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// BrailleSpinner
// ============================================================================

export const BRAILLE_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class BrailleSpinner {
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private label = '';
  private stream: NodeJS.WriteStream | null = null;

  getFrame(tick: number): string {
    return BRAILLE_CHARS[tick % BRAILLE_CHARS.length] ?? BRAILLE_CHARS[0] ?? '⠋';
  }

  getShimmer(text: string, tick: number): string {
    const brightness = 0.7 + 0.3 * Math.sin(tick * 0.3);
    const level = Math.round(brightness * 255);
    const hex = level.toString(16).padStart(2, '0');
    return `\x1b[38;2;${level};${level};${level}m${text}\x1b[0m`;
  }

  start(label: string, stream: NodeJS.WriteStream): void {
    this.label = label;
    this.stream = stream;
    this.tick = 0;
    this.timer = setInterval(() => {
      const frame = this.getFrame(this.tick);
      stream.write(`\r${frame} ${this.label}`);
      this.tick++;
    }, 80);
    logger.debug(`Spinner started: ${label}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream) {
      this.stream.write('\r\x1b[K');
    }
    logger.debug('Spinner stopped');
  }

  update(label: string): void {
    this.label = label;
  }
}

// ============================================================================
// CJKInputHandler
// ============================================================================

export class CJKInputHandler {
  /**
   * Check if a character is full-width (zenkaku)
   */
  isFullWidth(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0xFF01 && code <= 0xFF5E) || // Fullwidth ASCII variants
      (code >= 0x3000 && code <= 0x303F) || // CJK Symbols and Punctuation
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
      (code >= 0xAC00 && code <= 0xD7AF) || // Hangul Syllables
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) || // Katakana
      code === 0x3000 // Ideographic space
    );
  }

  /**
   * Convert full-width ASCII variants (FF01-FF5E) to half-width
   */
  normalizeFullWidth(input: string): string {
    let result = '';
    for (const char of input) {
      const code = char.charCodeAt(0);
      if (code >= 0xFF01 && code <= 0xFF5E) {
        result += String.fromCharCode(code - 0xFEE0);
      } else if (code === 0x3000) {
        result += ' ';
      } else {
        result += char;
      }
    }
    return result;
  }

  /**
   * Get display width accounting for CJK double-width characters
   */
  getDisplayWidth(text: string): number {
    let width = 0;
    for (const char of text) {
      width += this.isFullWidth(char) ? 2 : 1;
    }
    return width;
  }
}

// ============================================================================
// ITermProgressBar
// ============================================================================

export class ITermProgressBar {
  isITerm2(): boolean {
    return (
      process.env.TERM_PROGRAM === 'iTerm.app' ||
      process.env.LC_TERMINAL === 'iTerm2'
    );
  }

  setProgress(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    process.stdout.write(`\x1b]9;4;1;${clamped}\x07`);
  }

  clear(): void {
    process.stdout.write('\x1b]9;4;0;0\x07');
  }
}
