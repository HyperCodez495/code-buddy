/**
 * Shared types for multi-language code graph scanners.
 */

// ============================================================================
// Symbol & Call Types
// ============================================================================

export interface SymbolDef {
  fqn: string;
  name: string;
  kind: 'class' | 'method' | 'function';
  module: string;
  className?: string;
  line: number;
  params?: string;
  returnType?: string;
}

export interface CallSite {
  callerFqn: string;
  calleeName: string;
  isMethodCall: boolean;
  receiverClass?: string;
}

export interface InheritanceInfo {
  className: string;
  extends?: string;
  implements?: string[];
}

export interface ScanResult {
  symbols: SymbolDef[];
  calls: CallSite[];
  inheritance: InheritanceInfo[];
}

// ============================================================================
// Language Scanner Interface
// ============================================================================

export interface LanguageScanner {
  readonly extensions: string[];
  readonly language: string;
  scanFile(content: string, moduleId: string): ScanResult;
}

// ============================================================================
// Common Call Blacklist (language-agnostic control flow keywords)
// ============================================================================

export const COMMON_CALL_BLACKLIST = new Set([
  'if', 'else', 'for', 'while', 'switch', 'case', 'return', 'throw', 'new',
  'typeof', 'instanceof', 'delete', 'void', 'yield', 'await', 'catch',
  'try', 'finally', 'const', 'let', 'var', 'function', 'class', 'import',
  'export', 'from', 'require', 'super', 'this', 'constructor',
]);

// ============================================================================
// Brace-Based Scope Tracker (shared by TS, Go, Rust, Java)
// ============================================================================

export interface ScopeTracker {
  braceDepth: number;
  currentClassName: string | null;
  classStartDepth: number;
  currentFunctionFqn: string | null;
  funcStartDepth: number;
  /** Rust: impl block target struct */
  currentImplTarget?: string | null;
  /** Rust: impl trait name (if `impl Trait for Struct`) */
  currentImplTrait?: string | null;
  implStartDepth?: number;
}

export function createScopeTracker(): ScopeTracker {
  return {
    braceDepth: 0,
    currentClassName: null,
    classStartDepth: -1,
    currentFunctionFqn: null,
    funcStartDepth: -1,
  };
}

export function updateBraceDepth(line: string, tracker: ScopeTracker): void {
  for (const ch of line) {
    if (ch === '{') tracker.braceDepth++;
    if (ch === '}') {
      tracker.braceDepth--;
      if (tracker.classStartDepth >= 0 && tracker.braceDepth <= tracker.classStartDepth) {
        tracker.currentClassName = null;
        tracker.classStartDepth = -1;
      }
      if (tracker.funcStartDepth >= 0 && tracker.braceDepth <= tracker.funcStartDepth) {
        tracker.currentFunctionFqn = null;
        tracker.funcStartDepth = -1;
      }
      if (tracker.implStartDepth !== undefined && tracker.implStartDepth >= 0
          && tracker.braceDepth <= tracker.implStartDepth) {
        tracker.currentImplTarget = null;
        tracker.currentImplTrait = null;
        tracker.implStartDepth = -1;
      }
    }
  }
}

// ============================================================================
// Multi-line Parameter Extraction (shared utility)
// ============================================================================

/**
 * Extract parameters that span multiple lines.
 * Starting from the opening '(' on line `startIdx`, collects until ')'.
 */
export function extractMultiLineParams(lines: string[], startIdx: number): string | null {
  let depth = 0;
  let collecting = false;
  const parts: string[] = [];

  for (let i = startIdx; i < Math.min(startIdx + 15, lines.length); i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === undefined) continue;
      if (ch === '(') {
        if (!collecting) {
          collecting = true;
          depth = 1;
          continue;
        }
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0 && collecting) {
          const raw = parts.join('').trim();
          return raw ? `(${raw})` : '()';
        }
      }
      if (collecting && depth > 0) {
        parts.push(ch);
      }
    }
    if (collecting) parts.push(' ');
  }
  return null;
}

/**
 * After extracting params, look for a return type annotation after closing paren.
 * Works for TS (`: Type`), Go (`Type`), Rust (`-> Type`).
 */
export function extractReturnTypeAfterParams(
  lines: string[],
  startIdx: number,
  returnMarker: RegExp = /^:\s*([^{=>;]+)/,
): string | undefined {
  let depth = 0;
  let foundClose = false;

  for (let i = startIdx; i < Math.min(startIdx + 15, lines.length); i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '(') depth++;
      if (line[j] === ')') {
        depth--;
        if (depth === 0) {
          const rest = line.substring(j + 1).trim();
          const retMatch = rest.match(returnMarker);
          if (retMatch && retMatch[1] !== undefined) return retMatch[1].trim();
          foundClose = true;
          break;
        }
      }
    }
    if (foundClose) {
      const nextLine = lines[i + 1];
      if (nextLine !== undefined) {
        const retMatch = nextLine.trim().match(returnMarker);
        if (retMatch && retMatch[1] !== undefined) return retMatch[1].trim();
      }
      break;
    }
  }
  return undefined;
}
