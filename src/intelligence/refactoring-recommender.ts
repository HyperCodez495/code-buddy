/**
 * Intelligent Refactoring Recommender
 *
 * Analyzes code and provides intelligent refactoring recommendations:
 * - Code smell detection
 * - Pattern-based suggestions
 * - Complexity reduction
 * - Modern syntax upgrades
 */

export type RefactoringCategory =
  | 'extract-method'
  | 'extract-variable'
  | 'inline'
  | 'rename'
  | 'move'
  | 'simplify'
  | 'modernize'
  | 'performance'
  | 'readability'
  | 'dry';

export type RefactoringPriority = 'low' | 'medium' | 'high' | 'critical';

export interface RefactoringRecommendation {
  id: string;
  category: RefactoringCategory;
  priority: RefactoringPriority;
  title: string;
  description: string;
  location: {
    startLine: number;
    endLine: number;
    code?: string;
  };
  suggestion: string;
  example?: {
    before: string;
    after: string;
  };
  estimatedImpact: {
    readability: number; // 1-5
    maintainability: number; // 1-5
    performance: number; // 1-5
  };
}

export interface RefactoringReport {
  filePath?: string;
  language: string;
  recommendations: RefactoringRecommendation[];
  summary: {
    total: number;
    byCategory: Record<RefactoringCategory, number>;
    byPriority: Record<RefactoringPriority, number>;
    overallScore: number; // 0-100
  };
  analyzedAt: Date;
}

interface RefactoringRule {
  id: string;
  category: RefactoringCategory;
  priority: RefactoringPriority;
  title: string;
  description: string;
  pattern: RegExp;
  suggestion: string;
  example?: { before: string; after: string };
  multiLine?: boolean;
  languages?: string[];
}

/**
 * Refactoring detection rules
 */
const REFACTORING_RULES: RefactoringRule[] = [
  // Extract Method opportunities
  {
    id: 'long-function',
    category: 'extract-method',
    priority: 'high',
    title: 'Long function - consider extraction',
    description: 'Function is too long and should be broken into smaller functions',
    pattern: /function\s+\w+[^{]*\{[\s\S]{1500,}?\}/,
    suggestion: 'Extract logical blocks into separate named functions',
    multiLine: true,
  },
  {
    id: 'repeated-code-block',
    category: 'extract-method',
    priority: 'high',
    title: 'Repeated code block detected',
    description: 'Similar code appears multiple times - extract into a reusable function',
    pattern: /(.{50,})\n[\s\S]{0,200}\1/,
    suggestion: 'Create a function for the repeated logic',
    multiLine: true,
  },
  {
    id: 'complex-conditional',
    category: 'extract-method',
    priority: 'medium',
    title: 'Complex conditional - extract to function',
    description: 'Complex condition should be extracted to a named function',
    pattern: /if\s*\([^)]{80,}\)/,
    suggestion: 'Extract condition to a descriptive function like isUserEligible()',
    example: {
      before: 'if (user.age >= 18 && user.verified && !user.banned && user.subscription)',
      after: 'if (isEligibleUser(user))',
    },
  },

  // Extract Variable
  {
    id: 'magic-number',
    category: 'extract-variable',
    priority: 'medium',
    title: 'Magic number detected',
    description: 'Numeric literal should be extracted to a named constant',
    pattern: /(?<![.\w])\d{4,}(?![.\w])|(?<![.\w])(?:86400|3600|1000|60000|86400000)\b/,
    suggestion: 'Extract to a named constant like MAX_TIMEOUT_MS or SECONDS_PER_DAY',
    example: {
      before: 'setTimeout(callback, 86400000);',
      after: 'const MS_PER_DAY = 86400000;\nsetTimeout(callback, MS_PER_DAY);',
    },
  },
  {
    id: 'repeated-expression',
    category: 'extract-variable',
    priority: 'low',
    title: 'Repeated expression',
    description: 'Same expression computed multiple times',
    pattern: /(\w+\.\w+\.\w+)[\s\S]{0,50}\1[\s\S]{0,50}\1/,
    suggestion: 'Extract to a variable to avoid repeated property access',
    multiLine: true,
  },

  // Simplify
  {
    id: 'nested-ternary',
    category: 'simplify',
    priority: 'high',
    title: 'Nested ternary operators',
    description: 'Nested ternaries are hard to read - use if/else or switch',
    pattern: /\?[^:]+\?[^:]+:/,
    suggestion: 'Replace with if/else statements or a lookup object',
    example: {
      before: 'const val = a ? b ? c : d : e;',
      after: 'let val;\nif (a) {\n  val = b ? c : d;\n} else {\n  val = e;\n}',
    },
  },
  {
    id: 'double-negation',
    category: 'simplify',
    priority: 'low',
    title: 'Double negation',
    description: 'Double negation is confusing - simplify the condition',
    pattern: /!\s*!\s*\w|!\s*\w+\s*!==|!\(\s*!\w+\s*\)/,
    suggestion: 'Remove double negation for clarity',
    example: {
      before: 'if (!!value)',
      after: 'if (value)',
    },
  },
  {
    id: 'unnecessary-else',
    category: 'simplify',
    priority: 'low',
    title: 'Unnecessary else after return',
    description: 'Else block after return is redundant',
    pattern: /return[^;]*;\s*}\s*else\s*\{/,
    suggestion: 'Remove else and reduce nesting',
    example: {
      before: 'if (x) {\n  return a;\n} else {\n  return b;\n}',
      after: 'if (x) {\n  return a;\n}\nreturn b;',
    },
  },
  {
    id: 'yoda-condition',
    category: 'simplify',
    priority: 'low',
    title: 'Yoda condition',
    description: 'Literal on left side of comparison is hard to read',
    pattern: /(?:null|undefined|true|false|['"][^'"]*['"]|\d+)\s*(?:===?|!==?)\s*\w+/,
    suggestion: 'Put variable on the left side of comparison',
    example: {
      before: "if ('admin' === role)",
      after: "if (role === 'admin')",
    },
  },

  // Modernize
  {
    id: 'var-to-const-let',
    category: 'modernize',
    priority: 'medium',
    title: 'Use const/let instead of var',
    description: 'var has function scope which can lead to bugs',
    pattern: /\bvar\s+\w+/,
    suggestion: 'Replace var with const (for unchanging values) or let',
    languages: ['javascript', 'typescript'],
  },
  {
    id: 'callback-to-async',
    category: 'modernize',
    priority: 'medium',
    title: 'Convert callback to async/await',
    description: 'Callback-based code can be simplified with async/await',
    pattern: /\.then\s*\(\s*(?:function|\([^)]*\)\s*=>)/,
    suggestion: 'Use async/await for cleaner asynchronous code',
    example: {
      before: 'fetchData().then(data => process(data)).catch(err => handle(err));',
      after: 'const data = await fetchData();\nprocess(data);',
    },
  },
  {
    id: 'string-concat-to-template',
    category: 'modernize',
    priority: 'low',
    title: 'Use template literals',
    description: 'String concatenation can be replaced with template literals',
    pattern: /['"][^'"]*['"]\s*\+\s*\w+\s*\+\s*['"][^'"]*['"]/,
    suggestion: 'Use template literals for string interpolation',
    example: {
      before: '"Hello, " + name + "!"',
      after: '`Hello, ${name}!`',
    },
  },
  {
    id: 'function-to-arrow',
    category: 'modernize',
    priority: 'low',
    title: 'Convert to arrow function',
    description: 'Short functions can be arrow functions',
    pattern: /function\s*\([^)]{0,30}\)\s*\{\s*return\s+[^;]{1,50};\s*\}/,
    suggestion: 'Use arrow function for concise syntax',
    example: {
      before: 'function(x) { return x * 2; }',
      after: '(x) => x * 2',
    },
  },
  {
    id: 'object-shorthand',
    category: 'modernize',
    priority: 'low',
    title: 'Use object shorthand',
    description: 'Property can use shorthand syntax',
    pattern: /(\w+)\s*:\s*\1(?:\s*[,}])/,
    suggestion: 'Use ES6 shorthand property syntax',
    example: {
      before: '{ name: name, age: age }',
      after: '{ name, age }',
    },
  },

  // Performance
  {
    id: 'array-push-in-loop',
    category: 'performance',
    priority: 'medium',
    title: 'Array push in loop',
    description: 'Building array in loop can be replaced with map/filter',
    pattern: /(?:for|while)\s*\([^)]*\)[^{]*\{[^}]*\.push\s*\(/,
    suggestion: 'Consider using Array.map() or Array.filter() instead',
    example: {
      before: 'for (item of items) { result.push(transform(item)); }',
      after: 'const result = items.map(transform);',
    },
    multiLine: true,
  },
  {
    id: 'repeated-dom-query',
    category: 'performance',
    priority: 'high',
    title: 'Repeated DOM query',
    description: 'Same DOM query executed multiple times',
    pattern: /(document\.(?:getElementById|querySelector)\s*\([^)]+\))[\s\S]{0,100}\1/,
    suggestion: 'Cache DOM element in a variable',
    multiLine: true,
  },
  {
    id: 'string-in-loop',
    category: 'performance',
    priority: 'medium',
    title: 'String concatenation in loop',
    description: 'String concatenation in loops is inefficient',
    pattern: /(?:for|while)\s*\([^)]*\)[^{]*\{[^}]*\+=\s*['"`]/,
    suggestion: 'Use Array.join() or template literals',
    multiLine: true,
  },

  // Readability
  {
    id: 'boolean-trap',
    category: 'readability',
    priority: 'medium',
    title: 'Boolean trap in function call',
    description: 'Boolean arguments are unclear - use named parameters',
    pattern: /\(\s*(?:true|false)\s*,\s*(?:true|false)\s*(?:,\s*(?:true|false)\s*)?\)/,
    suggestion: 'Use an options object with named properties',
    example: {
      before: 'createUser(true, false, true)',
      after: 'createUser({ admin: true, verified: false, active: true })',
    },
  },
  {
    id: 'single-letter-variable',
    category: 'readability',
    priority: 'low',
    title: 'Single-letter variable name',
    description: 'Non-descriptive variable names hurt readability',
    pattern: /(?:const|let|var)\s+[a-z]\s*=/,
    suggestion: 'Use descriptive variable names (except for loop indices)',
  },
  {
    id: 'deep-nesting',
    category: 'readability',
    priority: 'high',
    title: 'Deep nesting detected',
    description: 'Code is nested too deeply - flatten with early returns',
    pattern: /\{[^{}]*\{[^{}]*\{[^{}]*\{[^{}]*\{/,
    suggestion: 'Use early returns or extract helper functions',
    multiLine: true,
  },
  {
    id: 'long-parameter-list',
    category: 'readability',
    priority: 'medium',
    title: 'Too many parameters',
    description: 'Functions with many parameters are hard to use',
    pattern: /function\s+\w+\s*\(\s*\w+\s*(?:,\s*\w+\s*){4,}\)/,
    suggestion: 'Use an options object for multiple parameters',
    example: {
      before: 'function create(a, b, c, d, e, f) {}',
      after: 'function create(options: CreateOptions) {}',
    },
  },

  // DRY (Don't Repeat Yourself)
  {
    id: 'duplicate-catch',
    category: 'dry',
    priority: 'medium',
    title: 'Duplicate catch blocks',
    description: 'Similar error handling repeated - extract to function',
    pattern: /catch\s*\([^)]*\)\s*\{[^}]{30,}\}[\s\S]{0,200}catch\s*\([^)]*\)\s*\{[^}]{30,}\}/,
    suggestion: 'Extract common error handling to a shared function',
    multiLine: true,
  },
  {
    id: 'switch-duplication',
    category: 'dry',
    priority: 'medium',
    title: 'Similar switch cases',
    description: 'Switch cases with similar code can be consolidated',
    pattern: /case\s+[^:]+:\s*[^;]{20,};[\s\S]{0,50}case\s+[^:]+:\s*[^;]{20,};/,
    suggestion: 'Combine cases or extract common logic',
    multiLine: true,
  },
];

/**
 * Analyze code and provide refactoring recommendations
 */
export function analyzeForRefactoring(
  code: string,
  language: string = 'typescript',
  filePath?: string
): RefactoringReport {
  const recommendations: RefactoringRecommendation[] = [];
  const lines = code.split('\n');

  for (const rule of REFACTORING_RULES) {
    // Skip if rule is for different languages
    if (rule.languages && !rule.languages.includes(language)) {
      continue;
    }

    if (rule.multiLine) {
      // Check full code for multi-line patterns
      const matches = code.matchAll(new RegExp(rule.pattern, 'g'));
      for (const match of matches) {
        if (match.index !== undefined) {
          const beforeMatch = code.slice(0, match.index);
          const startLine = (beforeMatch.match(/\n/g) || []).length + 1;
          const matchLines = (match[0].match(/\n/g) || []).length;

          recommendations.push({
            id: `${rule.id}-${startLine}`,
            category: rule.category,
            priority: rule.priority,
            title: rule.title,
            description: rule.description,
            location: {
              startLine,
              endLine: startLine + matchLines,
              code: match[0].slice(0, 100) + (match[0].length > 100 ? '...' : ''),
            },
            suggestion: rule.suggestion,
            example: rule.example,
            estimatedImpact: getImpactEstimate(rule.category),
          });
        }
      }
    } else {
      // Check each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        const match = line.match(rule.pattern);

        if (match) {
          recommendations.push({
            id: `${rule.id}-${i + 1}`,
            category: rule.category,
            priority: rule.priority,
            title: rule.title,
            description: rule.description,
            location: {
              startLine: i + 1,
              endLine: i + 1,
              code: line.trim(),
            },
            suggestion: rule.suggestion,
            example: rule.example,
            estimatedImpact: getImpactEstimate(rule.category),
          });
        }
      }
    }
  }

  // Calculate summary
  const summary = calculateSummary(recommendations);

  return {
    filePath,
    language,
    recommendations,
    summary,
    analyzedAt: new Date(),
  };
}

/**
 * Get impact estimate based on category
 */
function getImpactEstimate(category: RefactoringCategory): RefactoringRecommendation['estimatedImpact'] {
  const impacts: Record<RefactoringCategory, RefactoringRecommendation['estimatedImpact']> = {
    'extract-method': { readability: 4, maintainability: 5, performance: 1 },
    'extract-variable': { readability: 4, maintainability: 3, performance: 1 },
    'inline': { readability: 3, maintainability: 2, performance: 2 },
    'rename': { readability: 5, maintainability: 4, performance: 1 },
    'move': { readability: 3, maintainability: 4, performance: 1 },
    'simplify': { readability: 5, maintainability: 4, performance: 2 },
    'modernize': { readability: 4, maintainability: 4, performance: 2 },
    'performance': { readability: 2, maintainability: 2, performance: 5 },
    'readability': { readability: 5, maintainability: 3, performance: 1 },
    'dry': { readability: 3, maintainability: 5, performance: 2 },
  };

  return impacts[category] || { readability: 3, maintainability: 3, performance: 3 };
}

/**
 * Calculate summary statistics
 */
function calculateSummary(recommendations: RefactoringRecommendation[]): RefactoringReport['summary'] {
  const byCategory = {} as Record<RefactoringCategory, number>;
  const byPriority = {} as Record<RefactoringPriority, number>;

  for (const rec of recommendations) {
    byCategory[rec.category] = (byCategory[rec.category] || 0) + 1;
    byPriority[rec.priority] = (byPriority[rec.priority] || 0) + 1;
  }

  // Calculate overall score (100 = no issues, lower = more issues)
  const priorityWeights = { critical: 10, high: 5, medium: 2, low: 1 };
  let totalWeight = 0;
  for (const rec of recommendations) {
    totalWeight += priorityWeights[rec.priority];
  }

  const overallScore = Math.max(0, 100 - totalWeight);

  return {
    total: recommendations.length,
    byCategory,
    byPriority,
    overallScore,
  };
}

/**
 * Format refactoring report for display
 */
export function formatRefactoringReport(report: RefactoringReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════',
    '              REFACTORING RECOMMENDATIONS',
    '═══════════════════════════════════════════════════════════',
    '',
  ];

  if (report.filePath) {
    lines.push(`File: ${report.filePath}`);
  }
  lines.push(`Language: ${report.language}`);
  lines.push(`Score: ${report.summary.overallScore}/100`);
  lines.push(`Analyzed: ${report.analyzedAt.toLocaleString()}`);
  lines.push('');

  if (report.recommendations.length === 0) {
    lines.push('No refactoring recommendations found.');
  } else {
    lines.push(`Found ${report.summary.total} recommendations:`);
    lines.push('');

    // Group by priority
    const priorityOrder: RefactoringPriority[] = ['critical', 'high', 'medium', 'low'];

    for (const priority of priorityOrder) {
      const items = report.recommendations.filter(r => r.priority === priority);
      if (items.length === 0) continue;

      const icon = priority === 'critical' ? '!!!' :
                   priority === 'high' ? '!!' :
                   priority === 'medium' ? '!' : '-';

      lines.push(`[${icon}] ${priority.toUpperCase()} (${items.length})`);
      lines.push('───────────────────────────────────────────────────────────');

      for (const rec of items) {
        lines.push(`  Line ${rec.location.startLine}: ${rec.title}`);
        lines.push(`    ${rec.description}`);
        lines.push(`    → ${rec.suggestion}`);

        if (rec.example) {
          lines.push(`    Before: ${rec.example.before}`);
          lines.push(`    After:  ${rec.example.after}`);
        }

        const impact = rec.estimatedImpact;
        lines.push(`    Impact: Read:${impact.readability} Maint:${impact.maintainability} Perf:${impact.performance}`);
        lines.push('');
      }
    }
  }

  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Get priority refactoring recommendations
 */
export function getPriorityRecommendations(
  report: RefactoringReport,
  limit: number = 5
): RefactoringRecommendation[] {
  const priorityOrder: RefactoringPriority[] = ['critical', 'high', 'medium', 'low'];

  return [...report.recommendations]
    .sort((a, b) => {
      return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
    })
    .slice(0, limit);
}

/**
 * Get recommendations by category
 */
export function getRecommendationsByCategory(
  report: RefactoringReport,
  category: RefactoringCategory
): RefactoringRecommendation[] {
  return report.recommendations.filter(r => r.category === category);
}

/**
 * Estimate refactoring effort
 */
export function estimateRefactoringEffort(report: RefactoringReport): {
  totalItems: number;
  estimatedMinutes: number;
  breakdown: Record<RefactoringPriority, number>;
} {
  const minutesPerPriority = {
    critical: 30,
    high: 15,
    medium: 10,
    low: 5,
  };

  let estimatedMinutes = 0;
  const breakdown = {} as Record<RefactoringPriority, number>;

  for (const rec of report.recommendations) {
    const minutes = minutesPerPriority[rec.priority];
    estimatedMinutes += minutes;
    breakdown[rec.priority] = (breakdown[rec.priority] || 0) + minutes;
  }

  return {
    totalItems: report.recommendations.length,
    estimatedMinutes,
    breakdown,
  };
}

export default analyzeForRefactoring;
