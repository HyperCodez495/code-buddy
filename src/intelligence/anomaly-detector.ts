/**
 * Code Anomaly Detector
 *
 * Detects anomalies and potential issues in code:
 * - Unusual patterns
 * - Security vulnerabilities
 * - Performance anti-patterns
 * - Inconsistencies
 */

export type AnomalySeverity = 'info' | 'warning' | 'error' | 'critical';
export type AnomalyCategory =
  | 'security'
  | 'performance'
  | 'consistency'
  | 'complexity'
  | 'deprecated'
  | 'style'
  | 'logic';

export interface CodeAnomaly {
  id: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  message: string;
  description: string;
  line?: number;
  column?: number;
  code?: string;
  suggestion?: string;
  reference?: string;
}

export interface AnomalyReport {
  filePath?: string;
  language: string;
  anomalies: CodeAnomaly[];
  summary: {
    total: number;
    byCategory: Record<AnomalyCategory, number>;
    bySeverity: Record<AnomalySeverity, number>;
  };
  scannedAt: Date;
}

interface AnomalyPattern {
  id: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  pattern: RegExp;
  message: string;
  description: string;
  suggestion?: string;
  reference?: string;
  languages?: string[];
}

/**
 * Anomaly detection patterns
 */
const ANOMALY_PATTERNS: AnomalyPattern[] = [
  // Security issues
  {
    id: 'sql-injection',
    category: 'security',
    severity: 'critical',
    pattern: /(\$\{|" \+ |' \+ ).*?(SELECT|INSERT|UPDATE|DELETE|DROP)/i,
    message: 'Potential SQL injection vulnerability',
    description: 'String concatenation in SQL queries can lead to SQL injection attacks',
    suggestion: 'Use parameterized queries or prepared statements',
    reference: 'https://owasp.org/www-community/attacks/SQL_Injection',
  },
  {
    id: 'xss-vulnerability',
    category: 'security',
    severity: 'critical',
    pattern: /innerHTML\s*=|document\.write\s*\(|\.html\s*\(\s*[^)]*\$\{/,
    message: 'Potential XSS vulnerability',
    description: 'Dynamic HTML content without sanitization can lead to XSS attacks',
    suggestion: 'Use textContent or sanitize HTML before insertion',
    reference: 'https://owasp.org/www-community/attacks/xss/',
  },
  {
    id: 'eval-usage',
    category: 'security',
    severity: 'error',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    message: 'Use of eval() or Function constructor',
    description: 'eval() can execute arbitrary code and is a security risk',
    suggestion: 'Avoid eval() and find alternative approaches',
  },
  {
    id: 'hardcoded-secret',
    category: 'security',
    severity: 'critical',
    pattern: /(password|secret|api_?key|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    message: 'Potential hardcoded secret',
    description: 'Secrets should not be hardcoded in source files',
    suggestion: 'Use environment variables or a secrets manager',
  },
  {
    id: 'insecure-random',
    category: 'security',
    severity: 'warning',
    pattern: /Math\.random\s*\(\)/,
    message: 'Insecure random number generation',
    description: 'Math.random() is not cryptographically secure',
    suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security purposes',
  },

  // Performance issues
  {
    id: 'sync-fs-operations',
    category: 'performance',
    severity: 'warning',
    pattern: /\.(readFileSync|writeFileSync|existsSync|readdirSync|statSync|mkdirSync)\s*\(/,
    message: 'Synchronous file system operation',
    description: 'Sync operations block the event loop and harm performance',
    suggestion: 'Use async/await with fs.promises or callback-based methods',
    languages: ['javascript', 'typescript'],
  },
  {
    id: 'nested-loops',
    category: 'performance',
    severity: 'warning',
    pattern: /for\s*\([^)]+\)[^{]*\{[^}]*for\s*\([^)]+\)[^{]*\{[^}]*for\s*\(/,
    message: 'Triple nested loops detected',
    description: 'Deeply nested loops can cause O(n³) or worse complexity',
    suggestion: 'Consider refactoring to reduce nesting or use more efficient algorithms',
  },
  {
    id: 'console-in-loop',
    category: 'performance',
    severity: 'info',
    pattern: /(?:for|while)\s*\([^)]*\)[^{]*\{[^}]*console\.(log|debug|info)/,
    message: 'Console logging inside loop',
    description: 'Logging in loops can significantly slow down execution',
    suggestion: 'Remove or conditionally enable console statements in loops',
  },
  {
    id: 'array-in-render',
    category: 'performance',
    severity: 'warning',
    pattern: /render\s*\([^)]*\)\s*\{[^}]*\.(map|filter|reduce)\s*\(/,
    message: 'Array operation in render method',
    description: 'Creating new arrays on every render hurts performance',
    suggestion: 'Move array operations outside render or use useMemo/memoization',
    languages: ['javascript', 'typescript'],
  },

  // Logic issues
  {
    id: 'assignment-in-condition',
    category: 'logic',
    severity: 'warning',
    pattern: /if\s*\(\s*\w+\s*=\s*[^=]/,
    message: 'Assignment in condition',
    description: 'Using = instead of == or === in conditions is often a mistake',
    suggestion: 'Use === for comparison, or wrap assignment in parentheses if intentional',
  },
  {
    id: 'unreachable-code',
    category: 'logic',
    severity: 'error',
    pattern: /return\s+[^;]+;\s*\n\s*[^\s}]/,
    message: 'Potentially unreachable code after return',
    description: 'Code after a return statement will never execute',
    suggestion: 'Remove unreachable code or restructure logic',
  },
  {
    id: 'empty-catch',
    category: 'logic',
    severity: 'warning',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: 'Empty catch block',
    description: 'Silently swallowing errors makes debugging difficult',
    suggestion: 'Log the error or rethrow if not handling it',
  },
  {
    id: 'floating-promise',
    category: 'logic',
    severity: 'warning',
    pattern: /(?<!await\s)(?<!return\s)\w+\.\w+\([^)]*\)\s*;\s*\/\/\s*(?!ignore)/,
    message: 'Potentially unhandled promise',
    description: 'Async operations without await may cause unhandled rejections',
    suggestion: 'Add await or handle the promise with .catch()',
    languages: ['javascript', 'typescript'],
  },

  // Consistency issues
  {
    id: 'mixed-quotes',
    category: 'consistency',
    severity: 'info',
    pattern: /(['"])[^'"]*\1[^'"]*(['"])[^'"]*\2/,
    message: 'Mixed quote styles',
    description: 'Inconsistent use of single and double quotes',
    suggestion: 'Choose one quote style and use it consistently',
  },
  {
    id: 'inconsistent-return',
    category: 'consistency',
    severity: 'warning',
    pattern: /function\s+\w+[^{]*\{(?:[^}]*return\s+[^;]+;[^}]*return\s*;|[^}]*return\s*;[^}]*return\s+[^;]+)/,
    message: 'Inconsistent return statements',
    description: 'Function has both explicit and implicit returns',
    suggestion: 'Use consistent return statements throughout the function',
  },

  // Complexity issues
  {
    id: 'long-function',
    category: 'complexity',
    severity: 'warning',
    pattern: /function\s+\w+[^{]*\{[\s\S]{2000,}\}/,
    message: 'Very long function',
    description: 'Functions over ~50 lines are hard to understand and maintain',
    suggestion: 'Break down into smaller, focused functions',
  },
  {
    id: 'too-many-params',
    category: 'complexity',
    severity: 'warning',
    pattern: /function\s+\w+\s*\(\s*\w+\s*(?:,\s*\w+\s*){5,}\)/,
    message: 'Too many function parameters',
    description: 'Functions with many parameters are hard to use correctly',
    suggestion: 'Use an options object or refactor into smaller functions',
  },
  {
    id: 'deep-nesting',
    category: 'complexity',
    severity: 'warning',
    pattern: /\{[^{}]*\{[^{}]*\{[^{}]*\{[^{}]*\{/,
    message: 'Deep nesting detected',
    description: 'Deeply nested code is hard to read and maintain',
    suggestion: 'Use early returns, extract methods, or flatten logic',
  },

  // Deprecated patterns
  {
    id: 'var-usage',
    category: 'deprecated',
    severity: 'info',
    pattern: /\bvar\s+\w+/,
    message: 'Use of var keyword',
    description: 'var has function scope which can lead to bugs',
    suggestion: 'Use const or let instead of var',
    languages: ['javascript', 'typescript'],
  },
  {
    id: 'callback-hell',
    category: 'deprecated',
    severity: 'warning',
    pattern: /\)\s*=>\s*\{[^}]*\)\s*=>\s*\{[^}]*\)\s*=>\s*\{/,
    message: 'Callback nesting (callback hell)',
    description: 'Deeply nested callbacks are hard to read and maintain',
    suggestion: 'Use async/await or Promise chains',
    languages: ['javascript', 'typescript'],
  },
];

/**
 * Detect anomalies in code
 */
export function detectAnomalies(
  code: string,
  language: string = 'typescript',
  filePath?: string
): AnomalyReport {
  const anomalies: CodeAnomaly[] = [];
  const lines = code.split('\n');

  for (const pattern of ANOMALY_PATTERNS) {
    // Skip if pattern is for different languages
    if (pattern.languages && !pattern.languages.includes(language)) {
      continue;
    }

    // Check each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const match = line.match(pattern.pattern);

      if (match) {
        anomalies.push({
          id: `${pattern.id}-${i + 1}`,
          category: pattern.category,
          severity: pattern.severity,
          message: pattern.message,
          description: pattern.description,
          line: i + 1,
          column: match.index,
          code: line.trim(),
          suggestion: pattern.suggestion,
          reference: pattern.reference,
        });
      }
    }

    // Also check full code for multi-line patterns
    const fullMatch = code.match(pattern.pattern);
    if (fullMatch && !anomalies.some(a => a.id.startsWith(pattern.id))) {
      // Find line number
      const beforeMatch = code.slice(0, fullMatch.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      anomalies.push({
        id: `${pattern.id}-full`,
        category: pattern.category,
        severity: pattern.severity,
        message: pattern.message,
        description: pattern.description,
        line: lineNumber,
        suggestion: pattern.suggestion,
        reference: pattern.reference,
      });
    }
  }

  // Calculate summary
  const summary = {
    total: anomalies.length,
    byCategory: {} as Record<AnomalyCategory, number>,
    bySeverity: {} as Record<AnomalySeverity, number>,
  };

  for (const anomaly of anomalies) {
    summary.byCategory[anomaly.category] = (summary.byCategory[anomaly.category] || 0) + 1;
    summary.bySeverity[anomaly.severity] = (summary.bySeverity[anomaly.severity] || 0) + 1;
  }

  return {
    filePath,
    language,
    anomalies,
    summary,
    scannedAt: new Date(),
  };
}

/**
 * Format anomaly report for display
 */
export function formatAnomalyReport(report: AnomalyReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════',
    '              ANOMALY DETECTION REPORT',
    '═══════════════════════════════════════════════════',
    '',
  ];

  if (report.filePath) {
    lines.push(`File: ${report.filePath}`);
  }
  lines.push(`Language: ${report.language}`);
  lines.push(`Scanned: ${report.scannedAt.toLocaleString()}`);
  lines.push('');

  if (report.anomalies.length === 0) {
    lines.push('No anomalies detected.');
  } else {
    lines.push(`Found ${report.summary.total} anomalies:`);
    lines.push('');

    // Group by severity
    const severityOrder: AnomalySeverity[] = ['critical', 'error', 'warning', 'info'];

    for (const severity of severityOrder) {
      const items = report.anomalies.filter(a => a.severity === severity);
      if (items.length === 0) continue;

      const icon = severity === 'critical' ? '!!!' :
                   severity === 'error' ? '!!' :
                   severity === 'warning' ? '!' : 'i';

      lines.push(`[${icon}] ${severity.toUpperCase()} (${items.length})`);
      lines.push('───────────────────────────────────────────────────');

      for (const anomaly of items) {
        const location = anomaly.line ? `:${anomaly.line}` : '';
        lines.push(`  ${anomaly.message}${location}`);
        lines.push(`    ${anomaly.description}`);
        if (anomaly.suggestion) {
          lines.push(`    → ${anomaly.suggestion}`);
        }
        lines.push('');
      }
    }
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Get anomaly statistics
 */
export function getAnomalyStats(reports: AnomalyReport[]): {
  totalFiles: number;
  totalAnomalies: number;
  byCategory: Record<AnomalyCategory, number>;
  bySeverity: Record<AnomalySeverity, number>;
  topIssues: Array<{ message: string; count: number }>;
} {
  const stats = {
    totalFiles: reports.length,
    totalAnomalies: 0,
    byCategory: {} as Record<AnomalyCategory, number>,
    bySeverity: {} as Record<AnomalySeverity, number>,
    topIssues: [] as Array<{ message: string; count: number }>,
  };

  const issueCounts = new Map<string, number>();

  for (const report of reports) {
    stats.totalAnomalies += report.summary.total;

    for (const [cat, count] of Object.entries(report.summary.byCategory)) {
      stats.byCategory[cat as AnomalyCategory] =
        (stats.byCategory[cat as AnomalyCategory] || 0) + count;
    }

    for (const [sev, count] of Object.entries(report.summary.bySeverity)) {
      stats.bySeverity[sev as AnomalySeverity] =
        (stats.bySeverity[sev as AnomalySeverity] || 0) + count;
    }

    for (const anomaly of report.anomalies) {
      issueCounts.set(anomaly.message, (issueCounts.get(anomaly.message) || 0) + 1);
    }
  }

  stats.topIssues = Array.from(issueCounts.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return stats;
}

export default detectAnomalies;
