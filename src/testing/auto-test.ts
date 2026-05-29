/**
 * Auto-Test Integration Module
 *
 * Automatically runs tests after code changes and feeds results back to the LLM.
 * Research shows TDD integration improves Pass@1 by 45.97% (ICSE 2024).
 *
 * Supported test frameworks:
 * - Jest (JavaScript/TypeScript)
 * - Mocha (JavaScript/TypeScript)
 * - Vitest (JavaScript/TypeScript)
 * - pytest (Python)
 * - cargo test (Rust)
 * - go test (Go)
 * - RSpec (Ruby)
 */

import { spawn, SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";

/**
 * Test case result
 */
export interface TestCase {
  name: string;
  suite: string;
  file?: string;
  status: "passed" | "failed" | "skipped" | "pending";
  duration: number;
  error?: string;
  stack?: string;
}

/**
 * Test run result
 */
export interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  tests: TestCase[];
  coverage?: CoverageResult;
  framework: string;
}

/**
 * Coverage result
 */
export interface CoverageResult {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

/**
 * Test framework configuration
 */
export interface TestFrameworkConfig {
  name: string;
  command: string;
  args: string[];
  watchArgs?: string[];
  filePattern: RegExp;
  configFiles: string[];
  parseOutput: (output: string) => Partial<TestResult>;
  detectTestFile: (sourceFile: string) => string[];
}

/**
 * Auto-test configuration
 */
export interface AutoTestConfig {
  enabled: boolean;
  runOnSave: boolean;
  runRelatedTests: boolean;
  collectCoverage: boolean;
  timeout: number;
  maxTestFiles: number;
  watchMode: boolean;
}

/**
 * Default auto-test configuration
 */
export const DEFAULT_AUTOTEST_CONFIG: AutoTestConfig = {
  enabled: true,
  runOnSave: true,
  runRelatedTests: true,
  collectCoverage: false,
  timeout: 120000, // 2 minutes
  maxTestFiles: 10,
  watchMode: false,
};

/**
 * Built-in test framework configurations
 */
export const BUILTIN_FRAMEWORKS: Record<string, TestFrameworkConfig> = {
  jest: {
    name: "Jest",
    command: "npx",
    args: ["jest", "--json", "--passWithNoTests"],
    watchArgs: ["--watch"],
    filePattern: /\.(test|spec)\.(js|jsx|ts|tsx)$/,
    configFiles: ["jest.config.js", "jest.config.ts", "jest.config.json"],
    detectTestFile: (sourceFile: string): string[] => {
      const dir = path.dirname(sourceFile);
      const base = path.basename(sourceFile, path.extname(sourceFile));
      const ext = path.extname(sourceFile);
      return [
        path.join(dir, `${base}.test${ext}`),
        path.join(dir, `${base}.spec${ext}`),
        path.join(dir, "__tests__", `${base}.test${ext}`),
        path.join(dir, "__tests__", `${base}.spec${ext}`),
        sourceFile.replace(/\/src\//, "/tests/").replace(ext, `.test${ext}`),
      ];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      try {
        const result = JSON.parse(output);
        const tests: TestCase[] = [];

        for (const testResult of result.testResults || []) {
          for (const assertion of testResult.assertionResults || []) {
            tests.push({
              name: assertion.title,
              suite: assertion.ancestorTitles?.join(" > ") || "",
              file: testResult.name,
              status: assertion.status,
              duration: assertion.duration || 0,
              error: assertion.failureMessages?.[0],
            });
          }
        }

        return {
          success: result.success,
          passed: result.numPassedTests || 0,
          failed: result.numFailedTests || 0,
          skipped: result.numPendingTests || 0,
          total: result.numTotalTests || 0,
          tests,
        };
      } catch {
        return { success: false, tests: [] };
      }
    },
  },

  vitest: {
    name: "Vitest",
    command: "npx",
    args: ["vitest", "run", "--reporter=json"],
    watchArgs: ["--watch"],
    filePattern: /\.(test|spec)\.(js|jsx|ts|tsx)$/,
    configFiles: ["vitest.config.ts", "vitest.config.js", "vite.config.ts"],
    detectTestFile: (sourceFile: string): string[] => {
      const dir = path.dirname(sourceFile);
      const base = path.basename(sourceFile, path.extname(sourceFile));
      const ext = path.extname(sourceFile);
      return [
        path.join(dir, `${base}.test${ext}`),
        path.join(dir, `${base}.spec${ext}`),
        sourceFile.replace(/\/src\//, "/test/").replace(ext, `.test${ext}`),
      ];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      try {
        const result = JSON.parse(output);
        const tests: TestCase[] = [];

        for (const file of result.testResults || []) {
          for (const test of file.assertionResults || []) {
            tests.push({
              name: test.title,
              suite: test.ancestorTitles?.join(" > ") || "",
              file: file.name,
              status: test.status,
              duration: test.duration || 0,
              error: test.failureMessages?.[0],
            });
          }
        }

        return {
          success: result.success,
          passed: tests.filter(t => t.status === "passed").length,
          failed: tests.filter(t => t.status === "failed").length,
          skipped: tests.filter(t => t.status === "skipped").length,
          total: tests.length,
          tests,
        };
      } catch {
        return { success: false, tests: [] };
      }
    },
  },

  pytest: {
    name: "pytest",
    command: "python",
    args: ["-m", "pytest", "--tb=short", "-q", "--json-report", "--json-report-file=-"],
    watchArgs: ["--looponfail"],
    filePattern: /test_.*\.py$|.*_test\.py$/,
    configFiles: ["pytest.ini", "pyproject.toml", "setup.cfg"],
    detectTestFile: (sourceFile: string): string[] => {
      const dir = path.dirname(sourceFile);
      const base = path.basename(sourceFile, ".py");
      return [
        path.join(dir, `test_${base}.py`),
        path.join(dir, `${base}_test.py`),
        sourceFile.replace(/\/src\//, "/tests/").replace(`${base}.py`, `test_${base}.py`),
      ];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      try {
        const result = JSON.parse(output);
        const tests: TestCase[] = [];

        for (const test of result.tests || []) {
          tests.push({
            name: test.nodeid,
            suite: test.nodeid.split("::")[0],
            status: test.outcome === "passed" ? "passed" : test.outcome === "skipped" ? "skipped" : "failed",
            duration: test.duration || 0,
            error: test.call?.longrepr,
          });
        }

        return {
          success: result.exitcode === 0,
          passed: result.summary?.passed || 0,
          failed: result.summary?.failed || 0,
          skipped: result.summary?.skipped || 0,
          total: result.summary?.total || 0,
          tests,
        };
      } catch {
        return { success: false, tests: [] };
      }
    },
  },

  cargo: {
    name: "cargo test",
    command: "cargo",
    args: ["test", "--", "--format=json", "-Z", "unstable-options"],
    filePattern: /\.rs$/,
    configFiles: ["Cargo.toml"],
    detectTestFile: (sourceFile: string): string[] => {
      // Rust tests are usually in the same file
      return [sourceFile];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      const tests: TestCase[] = [];
      let passed = 0, failed = 0;

      for (const line of output.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "test" && event.event === "ok") {
            tests.push({
              name: event.name,
              suite: "",
              status: "passed",
              duration: event.exec_time || 0,
            });
            passed++;
          } else if (event.type === "test" && event.event === "failed") {
            tests.push({
              name: event.name,
              suite: "",
              status: "failed",
              duration: event.exec_time || 0,
              error: event.stdout,
            });
            failed++;
          }
        } catch {
          continue;
        }
      }

      return {
        success: failed === 0,
        passed,
        failed,
        skipped: 0,
        total: passed + failed,
        tests,
      };
    },
  },

  go: {
    name: "go test",
    command: "go",
    args: ["test", "-json", "./..."],
    filePattern: /_test\.go$/,
    configFiles: ["go.mod"],
    detectTestFile: (sourceFile: string): string[] => {
      const dir = path.dirname(sourceFile);
      const base = path.basename(sourceFile, ".go");
      return [path.join(dir, `${base}_test.go`)];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      const tests: TestCase[] = [];
      let passed = 0, failed = 0, skipped = 0;

      for (const line of output.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.Action === "pass" && event.Test) {
            tests.push({
              name: event.Test,
              suite: event.Package,
              status: "passed",
              duration: (event.Elapsed || 0) * 1000,
            });
            passed++;
          } else if (event.Action === "fail" && event.Test) {
            tests.push({
              name: event.Test,
              suite: event.Package,
              status: "failed",
              duration: (event.Elapsed || 0) * 1000,
              error: event.Output,
            });
            failed++;
          } else if (event.Action === "skip" && event.Test) {
            skipped++;
          }
        } catch {
          continue;
        }
      }

      return {
        success: failed === 0,
        passed,
        failed,
        skipped,
        total: passed + failed + skipped,
        tests,
      };
    },
  },

  rspec: {
    name: "RSpec",
    command: "bundle",
    args: ["exec", "rspec", "--format", "json"],
    filePattern: /_spec\.rb$/,
    configFiles: [".rspec", "spec/spec_helper.rb"],
    detectTestFile: (sourceFile: string): string[] => {
      return [sourceFile.replace(/\/lib\//, "/spec/").replace(".rb", "_spec.rb")];
    },
    parseOutput: (output: string): Partial<TestResult> => {
      try {
        const result = JSON.parse(output);
        const tests: TestCase[] = [];

        for (const example of result.examples || []) {
          tests.push({
            name: example.description,
            suite: example.full_description,
            file: example.file_path,
            status: example.status,
            duration: example.run_time * 1000,
            error: example.exception?.message,
            stack: example.exception?.backtrace?.join("\n"),
          });
        }

        return {
          success: result.summary?.failure_count === 0,
          passed: result.summary?.example_count - result.summary?.failure_count - result.summary?.pending_count,
          failed: result.summary?.failure_count || 0,
          skipped: result.summary?.pending_count || 0,
          total: result.summary?.example_count || 0,
          tests,
        };
      } catch {
        return { success: false, tests: [] };
      }
    },
  },
};

/**
 * Auto-Test Manager
 *
 * Manages automatic test execution after code changes.
 */
export class AutoTestManager extends EventEmitter {
  private config: AutoTestConfig;
  private detectedFramework: TestFrameworkConfig | null = null;
  private workingDirectory: string;
  private lastResults: TestResult | null = null;

  constructor(workingDirectory: string, config: Partial<AutoTestConfig> = {}) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_AUTOTEST_CONFIG, ...config };
    this.detectFramework();
  }

  /**
   * Detect test framework in the project
   */
  private detectFramework(): void {
    for (const [_key, framework] of Object.entries(BUILTIN_FRAMEWORKS)) {
      const hasConfig = framework.configFiles.some((file) =>
        fs.existsSync(path.join(this.workingDirectory, file))
      );

      if (hasConfig) {
        this.detectedFramework = framework;
        logger.debug(`Detected test framework: ${framework.name}`);
        this.emit("framework:detected", framework.name);
        return;
      }
    }

    // Check package.json for test scripts
    const pkgPath = path.join(this.workingDirectory, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
          this.detectedFramework = BUILTIN_FRAMEWORKS.jest ?? null;
        } else if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) {
          this.detectedFramework = BUILTIN_FRAMEWORKS.vitest ?? null;
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (this.detectedFramework) {
      this.emit("framework:detected", this.detectedFramework.name);
    }
  }

  /**
   * Run tests
   */
  private async runTests(args: string[]): Promise<TestResult> {
    const framework = this.detectedFramework;
    if (!framework) {
      return {
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        tests: [],
        framework: "none",
      };
    }

    const startTime = Date.now();
    const fullArgs = [...framework.args, ...args];

    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.workingDirectory,
        timeout: this.config.timeout,
        shell: true,
      };

      let stdout = "";
      let stderr = "";

      const proc = spawn(framework.command, fullArgs, options);

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        resolve({
          success: false,
          passed: 0,
          failed: 1,
          skipped: 0,
          total: 1,
          duration: Date.now() - startTime,
          tests: [{
            name: "Test Runner Error",
            suite: "",
            status: "failed",
            duration: 0,
            error: error.message,
          }],
          framework: framework.name,
        });
      });

      proc.on("close", (_code) => {
        const output = stdout || stderr;
        const parsed = framework.parseOutput(output);
        const duration = Date.now() - startTime;

        const result: TestResult = {
          success: parsed.success ?? false,
          passed: parsed.passed ?? 0,
          failed: parsed.failed ?? 0,
          skipped: parsed.skipped ?? 0,
          total: parsed.total ?? 0,
          duration,
          tests: parsed.tests ?? [],
          coverage: parsed.coverage,
          framework: framework.name,
        };

        this.lastResults = result;
        resolve(result);
      });
    });
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<TestResult> {
    if (!this.config.enabled || !this.detectedFramework) {
      return {
        success: true,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        tests: [],
        framework: "none",
      };
    }

    this.emit("test:start", { type: "all" });
    const result = await this.runTests([]);
    this.emit("test:complete", result);
    return result;
  }

  /**
   * Run tests for specific files
   */
  async runTestFiles(files: string[]): Promise<TestResult> {
    if (!this.config.enabled || !this.detectedFramework) {
      return {
        success: true,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        tests: [],
        framework: "none",
      };
    }

    const testFiles = files.slice(0, this.config.maxTestFiles);
    this.emit("test:start", { type: "files", files: testFiles });
    const result = await this.runTests(testFiles);
    this.emit("test:complete", result);
    return result;
  }

  /**
   * Run tests related to changed source files
   */
  async runRelatedTests(sourceFiles: string[]): Promise<TestResult> {
    if (!this.config.enabled || !this.detectedFramework || !this.config.runRelatedTests) {
      return {
        success: true,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        tests: [],
        framework: "none",
      };
    }

    // Find related test files
    const testFiles: string[] = [];
    for (const sourceFile of sourceFiles) {
      const candidates = this.detectedFramework.detectTestFile(sourceFile);
      for (const candidate of candidates) {
        const fullPath = path.isAbsolute(candidate)
          ? candidate
          : path.join(this.workingDirectory, candidate);
        if (fs.existsSync(fullPath)) {
          testFiles.push(candidate);
          break;
        }
      }
    }

    if (testFiles.length === 0) {
      logger.debug("No related test files found");
      return {
        success: true,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        tests: [],
        framework: this.detectedFramework.name,
      };
    }

    return this.runTestFiles(testFiles);
  }

  /**
   * Format test results for LLM context
   */
  formatResultsForLLM(result: TestResult): string {
    const lines: string[] = [];

    if (result.success) {
      lines.push(`✅ Tests Passed: ${result.passed}/${result.total} (${result.framework})`);
      if (result.skipped > 0) {
        lines.push(`   Skipped: ${result.skipped}`);
      }
      lines.push(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
    } else {
      lines.push(`❌ Tests Failed: ${result.failed}/${result.total} (${result.framework})`);
      lines.push(`   Passed: ${result.passed}, Skipped: ${result.skipped}`);
      lines.push(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      lines.push("");
      lines.push("Failed Tests:");

      for (const test of result.tests.filter((t) => t.status === "failed")) {
        lines.push(`  ❌ ${test.suite ? `${test.suite} > ` : ""}${test.name}`);
        if (test.file) {
          lines.push(`     File: ${test.file}`);
        }
        if (test.error) {
          const errorLines = test.error.split("\n").slice(0, 5);
          for (const line of errorLines) {
            lines.push(`     ${line}`);
          }
          if (test.error.split("\n").length > 5) {
            lines.push(`     ... (truncated)`);
          }
        }
      }
    }

    if (result.coverage) {
      lines.push("");
      lines.push("Coverage:");
      lines.push(`  Lines: ${result.coverage.lines.toFixed(1)}%`);
      lines.push(`  Branches: ${result.coverage.branches.toFixed(1)}%`);
      lines.push(`  Functions: ${result.coverage.functions.toFixed(1)}%`);
    }

    return lines.join("\n");
  }

  /**
   * Get last test results
   */
  getLastResults(): TestResult | null {
    return this.lastResults;
  }

  /**
   * Get detected framework
   */
  getDetectedFramework(): string | null {
    return this.detectedFramework?.name || null;
  }

  /**
   * Get configuration
   */
  getConfig(): AutoTestConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoTestConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Re-detect framework
   */
  refresh(): void {
    this.detectedFramework = null;
    this.detectFramework();
  }
}

// Singleton instance
let testManager: AutoTestManager | null = null;

/**
 * Get or create auto-test manager instance
 */
export function getAutoTestManager(
  workingDirectory?: string,
  config?: Partial<AutoTestConfig>
): AutoTestManager {
  if (!testManager || workingDirectory) {
    testManager = new AutoTestManager(
      workingDirectory || process.cwd(),
      config
    );
  }
  return testManager;
}

/**
 * Initialize auto-test manager
 */
export function initializeAutoTest(
  workingDirectory: string,
  config?: Partial<AutoTestConfig>
): AutoTestManager {
  testManager = new AutoTestManager(workingDirectory, config);
  return testManager;
}
