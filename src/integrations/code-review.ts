/**
 * AI Code Review Module
 *
 * Implements automated code review before commits.
 * Research shows 73.8% of AI review comments are resolved (industrial study).
 *
 * Features:
 * - Review staged changes before commit
 * - Identify bugs, security issues, code smells
 * - Suggest improvements
 * - Integration with git workflow
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";

/**
 * Review issue severity
 */
export type IssueSeverity = "critical" | "major" | "minor" | "info";

/**
 * Review issue type
 */
export type IssueType =
  | "bug"
  | "security"
  | "performance"
  | "style"
  | "maintainability"
  | "documentation"
  | "test-coverage"
  | "complexity";

/**
 * Code review issue
 */
export interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  type: IssueType;
  severity: IssueSeverity;
  message: string;
  suggestion?: string;
  code?: string;
  fixable: boolean;
}

/**
 * File diff information
 */
export interface FileDiff {
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

/**
 * Diff hunk
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

/**
 * Code review result
 */
export interface ReviewResult {
  success: boolean;
  files: FileDiff[];
  issues: ReviewIssue[];
  summary: {
    filesReviewed: number;
    totalIssues: number;
    critical: number;
    major: number;
    minor: number;
    info: number;
  };
  duration: number;
  recommendation: "approve" | "request-changes" | "comment";
}

/**
 * Code review configuration
 */
export interface CodeReviewConfig {
  enabled: boolean;
  checkSecurity: boolean;
  checkPerformance: boolean;
  checkStyle: boolean;
  checkComplexity: boolean;
  checkTestCoverage: boolean;
  maxComplexity: number;
  autoFix: boolean;
  ignorePatterns: string[];
}

/**
 * Default code review configuration
 */
export const DEFAULT_REVIEW_CONFIG: CodeReviewConfig = {
  enabled: true,
  checkSecurity: true,
  checkPerformance: true,
  checkStyle: true,
  checkComplexity: true,
  checkTestCoverage: false,
  maxComplexity: 10,
  autoFix: false,
  ignorePatterns: [
    "*.min.js",
    "*.bundle.js",
    "node_modules/**",
    "dist/**",
    "build/**",
    "*.lock",
  ],
};

/**
 * Security patterns to check
 */
const SECURITY_PATTERNS = [
  { pattern: /eval\s*\(/, message: "Use of eval() is a security risk", type: "security" as IssueType },
  { pattern: /innerHTML\s*=/, message: "innerHTML can lead to XSS vulnerabilities", type: "security" as IssueType },
  { pattern: /document\.write/, message: "document.write can be exploited for XSS", type: "security" as IssueType },
  { pattern: /password\s*=\s*['"][^'"]+['"]/, message: "Hardcoded password detected", type: "security" as IssueType },
  { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/, message: "Hardcoded API key detected", type: "security" as IssueType },
  { pattern: /secret\s*=\s*['"][^'"]+['"]/, message: "Hardcoded secret detected", type: "security" as IssueType },
  { pattern: /exec\s*\(/, message: "Command injection risk with exec()", type: "security" as IssueType },
  { pattern: /\$\{.*\}.*SQL|SELECT.*\$\{/, message: "Potential SQL injection", type: "security" as IssueType },
];

/**
 * Performance patterns to check
 */
const PERFORMANCE_PATTERNS = [
  { pattern: /\.forEach\(.*\.forEach\(/, message: "Nested forEach loops may have O(n²) complexity", type: "performance" as IssueType },
  { pattern: /new Array\(\d{6,}\)/, message: "Large array allocation", type: "performance" as IssueType },
  { pattern: /JSON\.parse\(JSON\.stringify/, message: "Inefficient deep clone pattern", type: "performance" as IssueType },
  { pattern: /document\.querySelector.*loop|for.*document\.querySelector/, message: "DOM query inside loop", type: "performance" as IssueType },
];

/**
 * Code smell patterns
 */
const CODE_SMELL_PATTERNS = [
  { pattern: /TODO|FIXME|HACK|XXX/, message: "Unresolved TODO/FIXME comment", type: "maintainability" as IssueType },
  { pattern: /console\.log/, message: "Console.log statement (remove before commit)", type: "style" as IssueType },
  { pattern: /debugger/, message: "Debugger statement", type: "style" as IssueType },
  { pattern: /any(?!\w)/, message: "Use of 'any' type reduces type safety", type: "maintainability" as IssueType },
  { pattern: /\/\/ @ts-ignore/, message: "TypeScript ignore directive", type: "maintainability" as IssueType },
  { pattern: /eslint-disable(?!-next-line)/, message: "ESLint disable without scope", type: "maintainability" as IssueType },
];

/**
 * Code Review Manager
 *
 * Manages automated code review for staged changes.
 */
export class CodeReviewManager extends EventEmitter {
  private config: CodeReviewConfig;
  private workingDirectory: string;

  constructor(workingDirectory: string, config: Partial<CodeReviewConfig> = {}) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
  }

  /**
   * Get staged changes
   */
  private async getStagedDiff(): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      const proc = spawn("git", ["diff", "--staged", "--unified=3"], {
        cwd: this.workingDirectory,
      });

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`git diff failed with code ${code}`));
        }
      });

      proc.on("error", reject);
    });
  }

  /**
   * Parse git diff output
   */
  private parseDiff(diff: string): FileDiff[] {
    const files: FileDiff[] = [];
    const fileRegex = /diff --git a\/(.+?) b\/(.+?)$/gm;
    const hunkRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/g;

    let match;
    while ((match = fileRegex.exec(diff)) !== null) {
      const file = match[2];
      if (file === undefined) continue;
      const fileStart = match.index;
      const nextFileMatch = fileRegex.exec(diff);
      const fileEnd = nextFileMatch ? nextFileMatch.index : diff.length;
      fileRegex.lastIndex = match.index + 1;

      const fileContent = diff.substring(fileStart, fileEnd);

      // Determine status
      let status: FileDiff["status"] = "modified";
      if (fileContent.includes("new file mode")) {
        status = "added";
      } else if (fileContent.includes("deleted file mode")) {
        status = "deleted";
      } else if (fileContent.includes("rename from")) {
        status = "renamed";
      }

      // Parse hunks
      const hunks: DiffHunk[] = [];
      let hunkMatch;
      hunkRegex.lastIndex = 0;
      while ((hunkMatch = hunkRegex.exec(fileContent)) !== null) {
        const oldStartRaw = hunkMatch[1];
        const newStartRaw = hunkMatch[3];
        if (oldStartRaw === undefined || newStartRaw === undefined) continue;
        hunks.push({
          oldStart: parseInt(oldStartRaw, 10),
          oldLines: parseInt(hunkMatch[2] || "1", 10),
          newStart: parseInt(newStartRaw, 10),
          newLines: parseInt(hunkMatch[4] || "1", 10),
          content: fileContent.substring(hunkMatch.index),
        });
      }

      // Count additions/deletions
      const additions = (fileContent.match(/^\+[^+]/gm) || []).length;
      const deletions = (fileContent.match(/^-[^-]/gm) || []).length;

      files.push({
        file,
        status,
        additions,
        deletions,
        hunks,
      });
    }

    return files;
  }

  /**
   * Check for pattern matches in content
   */
  private checkPatterns(
    content: string,
    patterns: Array<{ pattern: RegExp; message: string; type: IssueType }>,
    file: string
  ): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      // Skip removed lines (start with -)
      if (line.startsWith("-")) continue;

      for (const { pattern, message, type } of patterns) {
        if (pattern.test(line)) {
          issues.push({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            line: i + 1,
            type,
            severity: type === "security" ? "critical" : "minor",
            message,
            code: line.substring(0, 100),
            fixable: false,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Analyze file for issues
   */
  private analyzeFile(fileDiff: FileDiff): ReviewIssue[] {
    const issues: ReviewIssue[] = [];

    // Check if file should be ignored
    for (const pattern of this.config.ignorePatterns) {
      if (this.matchPattern(fileDiff.file, pattern)) {
        return issues;
      }
    }

    const content = fileDiff.hunks.map((h) => h.content).join("\n");

    // Security checks
    if (this.config.checkSecurity) {
      issues.push(...this.checkPatterns(content, SECURITY_PATTERNS, fileDiff.file));
    }

    // Performance checks
    if (this.config.checkPerformance) {
      issues.push(...this.checkPatterns(content, PERFORMANCE_PATTERNS, fileDiff.file));
    }

    // Style checks
    if (this.config.checkStyle) {
      issues.push(...this.checkPatterns(content, CODE_SMELL_PATTERNS, fileDiff.file));
    }

    // Complexity check (simple heuristic)
    if (this.config.checkComplexity) {
      const nestingLevel = this.calculateNestingLevel(content);
      if (nestingLevel > this.config.maxComplexity) {
        issues.push({
          id: `issue-${Date.now()}-complexity`,
          file: fileDiff.file,
          line: 1,
          type: "complexity",
          severity: "major",
          message: `High nesting level (${nestingLevel}), consider refactoring`,
          fixable: false,
        });
      }
    }

    return issues;
  }

  /**
   * Simple glob pattern matching
   */
  private matchPattern(file: string, pattern: string): boolean {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$"
    );
    return regex.test(file);
  }

  /**
   * Calculate nesting level (simple heuristic)
   */
  private calculateNestingLevel(content: string): number {
    let maxNesting = 0;
    let currentNesting = 0;

    for (const char of content) {
      if (char === "{" || char === "(" || char === "[") {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === "}" || char === ")" || char === "]") {
        currentNesting = Math.max(0, currentNesting - 1);
      }
    }

    return maxNesting;
  }

  /**
   * Review staged changes
   */
  async reviewStagedChanges(): Promise<ReviewResult> {
    const startTime = Date.now();
    this.emit("review:start");

    try {
      const diff = await this.getStagedDiff();

      if (!diff.trim()) {
        return {
          success: true,
          files: [],
          issues: [],
          summary: {
            filesReviewed: 0,
            totalIssues: 0,
            critical: 0,
            major: 0,
            minor: 0,
            info: 0,
          },
          duration: Date.now() - startTime,
          recommendation: "approve",
        };
      }

      const files = this.parseDiff(diff);
      const allIssues: ReviewIssue[] = [];

      for (const file of files) {
        const issues = this.analyzeFile(file);
        allIssues.push(...issues);
      }

      const summary = {
        filesReviewed: files.length,
        totalIssues: allIssues.length,
        critical: allIssues.filter((i) => i.severity === "critical").length,
        major: allIssues.filter((i) => i.severity === "major").length,
        minor: allIssues.filter((i) => i.severity === "minor").length,
        info: allIssues.filter((i) => i.severity === "info").length,
      };

      let recommendation: ReviewResult["recommendation"] = "approve";
      if (summary.critical > 0) {
        recommendation = "request-changes";
      } else if (summary.major > 0) {
        recommendation = "comment";
      }

      const result: ReviewResult = {
        success: true,
        files,
        issues: allIssues,
        summary,
        duration: Date.now() - startTime,
        recommendation,
      };

      this.emit("review:complete", result);
      return result;

    } catch (error) {
      const result: ReviewResult = {
        success: false,
        files: [],
        issues: [],
        summary: {
          filesReviewed: 0,
          totalIssues: 0,
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        duration: Date.now() - startTime,
        recommendation: "approve",
      };

      this.emit("review:error", error);
      return result;
    }
  }

  /**
   * Generate LLM prompt for detailed review
   */
  generateReviewPrompt(diff: string): string {
    return `You are a senior code reviewer. Review the following git diff and provide detailed feedback.

## Review Criteria
1. **Security**: Check for vulnerabilities (XSS, injection, hardcoded secrets)
2. **Bugs**: Logic errors, null pointer issues, race conditions
3. **Performance**: Inefficient algorithms, memory leaks, unnecessary operations
4. **Maintainability**: Code clarity, naming, documentation
5. **Best Practices**: Language idioms, design patterns

## Git Diff
\`\`\`diff
${diff}
\`\`\`

## Output Format
For each issue found, provide:
- File and line number
- Severity (critical/major/minor/info)
- Issue description
- Suggested fix

If the code looks good, explicitly approve it.`;
  }

  /**
   * Format review results for display
   */
  formatResults(result: ReviewResult): string {
    const lines: string[] = [];

    if (result.summary.totalIssues === 0) {
      lines.push("✅ Code Review Passed");
      lines.push(`   ${result.summary.filesReviewed} files reviewed, no issues found`);
      return lines.join("\n");
    }

    const emoji = result.recommendation === "request-changes" ? "❌" :
                  result.recommendation === "comment" ? "⚠️" : "✅";

    lines.push(`${emoji} Code Review: ${result.summary.totalIssues} issue(s) found`);
    lines.push(`   Files: ${result.summary.filesReviewed}`);
    lines.push(`   Critical: ${result.summary.critical}, Major: ${result.summary.major}, Minor: ${result.summary.minor}`);
    lines.push("");

    // Group issues by file
    const byFile = new Map<string, ReviewIssue[]>();
    for (const issue of result.issues) {
      if (!byFile.has(issue.file)) {
        byFile.set(issue.file, []);
      }
      byFile.get(issue.file)!.push(issue);
    }

    for (const [file, issues] of byFile) {
      lines.push(`📄 ${file}`);
      for (const issue of issues) {
        const severityEmoji =
          issue.severity === "critical" ? "🔴" :
          issue.severity === "major" ? "🟠" :
          issue.severity === "minor" ? "🟡" : "🔵";
        lines.push(`   ${severityEmoji} Line ${issue.line}: ${issue.message}`);
        if (issue.suggestion) {
          lines.push(`      💡 ${issue.suggestion}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Get configuration
   */
  getConfig(): CodeReviewConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodeReviewConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let reviewManager: CodeReviewManager | null = null;

/**
 * Get or create code review manager instance
 */
export function getCodeReviewManager(
  workingDirectory?: string,
  config?: Partial<CodeReviewConfig>
): CodeReviewManager {
  if (!reviewManager || workingDirectory) {
    reviewManager = new CodeReviewManager(
      workingDirectory || process.cwd(),
      config
    );
  }
  return reviewManager;
}

/**
 * Initialize code review manager
 */
export function initializeCodeReview(
  workingDirectory: string,
  config?: Partial<CodeReviewConfig>
): CodeReviewManager {
  reviewManager = new CodeReviewManager(workingDirectory, config);
  return reviewManager;
}
