/**
 * Tool Usage Analytics Module
 *
 * Tracks tool usage patterns, success/failure rates, and provides insights
 * for optimizing tool selection and execution.
 *
 * Features:
 * - Track tool execution frequency
 * - Track success/failure rates per tool
 * - Track execution duration
 * - Learn from successful tool chains
 * - Provide smart suggestions based on patterns
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface ToolExecution {
  toolName: string;
  timestamp: Date;
  success: boolean;
  duration: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  context?: string;
}

export interface ToolStats {
  toolName: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastUsed: Date;
  commonErrors: string[];
}

export interface ToolChain {
  tools: string[];
  frequency: number;
  successRate: number;
  avgDuration: number;
  lastUsed: Date;
}

export interface ToolSuggestion {
  toolName: string;
  confidence: number;
  reason: string;
  basedOn: 'frequency' | 'success_rate' | 'pattern' | 'context';
}

export interface ToolAnalyticsSnapshot {
  totalExecutions: number;
  uniqueTools: number;
  overallSuccessRate: number;
  mostUsedTools: Array<{ name: string; count: number }>;
  highestSuccessRate: Array<{ name: string; rate: number }>;
  lowestSuccessRate: Array<{ name: string; rate: number }>;
  recentChains: ToolChain[];
  period: { start: Date; end: Date };
}

// ============================================================================
// Tool Analytics Class
// ============================================================================

export class ToolAnalytics extends EventEmitter {
  private executions: ToolExecution[] = [];
  private toolStats: Map<string, ToolStats> = new Map();
  private toolChains: Map<string, ToolChain> = new Map();
  private recentToolSequence: string[] = [];
  private maxExecutions: number = 10000;
  private maxChainLength: number = 5;
  private dataDir: string;
  private persistenceEnabled: boolean = true;

  constructor(dataDir?: string) {
    super();
    this.dataDir = dataDir || path.join(os.homedir(), '.codebuddy', 'analytics');
  }

  /**
   * Record a tool execution
   */
  recordExecution(execution: ToolExecution): void {
    this.executions.push(execution);

    // Trim if exceeds max
    if (this.executions.length > this.maxExecutions) {
      this.executions = this.executions.slice(-this.maxExecutions);
    }

    // Update tool stats
    this.updateToolStats(execution);

    // Update tool chains
    this.updateToolChains(execution.toolName);

    this.emit('execution:recorded', execution);
  }

  /**
   * Record a successful tool execution
   */
  recordSuccess(toolName: string, duration: number, context?: string): void {
    this.recordExecution({
      toolName,
      timestamp: new Date(),
      success: true,
      duration,
      context,
    });
  }

  /**
   * Record a failed tool execution
   */
  recordFailure(toolName: string, duration: number, error: string, context?: string): void {
    this.recordExecution({
      toolName,
      timestamp: new Date(),
      success: false,
      duration,
      error,
      context,
    });
  }

  /**
   * Update statistics for a tool
   */
  private updateToolStats(execution: ToolExecution): void {
    const existing = this.toolStats.get(execution.toolName);

    if (existing) {
      existing.totalExecutions++;
      if (execution.success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
        if (execution.error && !existing.commonErrors.includes(execution.error)) {
          existing.commonErrors.push(execution.error);
          if (existing.commonErrors.length > 5) {
            existing.commonErrors = existing.commonErrors.slice(-5);
          }
        }
      }
      existing.successRate = (existing.successCount / existing.totalExecutions) * 100;
      existing.avgDuration =
        (existing.avgDuration * (existing.totalExecutions - 1) + execution.duration) /
        existing.totalExecutions;
      existing.minDuration = Math.min(existing.minDuration, execution.duration);
      existing.maxDuration = Math.max(existing.maxDuration, execution.duration);
      existing.lastUsed = execution.timestamp;
    } else {
      this.toolStats.set(execution.toolName, {
        toolName: execution.toolName,
        totalExecutions: 1,
        successCount: execution.success ? 1 : 0,
        failureCount: execution.success ? 0 : 1,
        successRate: execution.success ? 100 : 0,
        avgDuration: execution.duration,
        minDuration: execution.duration,
        maxDuration: execution.duration,
        lastUsed: execution.timestamp,
        commonErrors: execution.error ? [execution.error] : [],
      });
    }
  }

  /**
   * Update tool chain patterns
   */
  private updateToolChains(toolName: string): void {
    this.recentToolSequence.push(toolName);

    // Keep only recent tools for chain detection
    if (this.recentToolSequence.length > this.maxChainLength * 2) {
      this.recentToolSequence = this.recentToolSequence.slice(-this.maxChainLength);
    }

    // Detect chains of 2-5 tools
    for (let len = 2; len <= Math.min(this.maxChainLength, this.recentToolSequence.length); len++) {
      const chain = this.recentToolSequence.slice(-len);
      const chainKey = chain.join(' -> ');

      const existing = this.toolChains.get(chainKey);
      if (existing) {
        existing.frequency++;
        existing.lastUsed = new Date();
      } else {
        this.toolChains.set(chainKey, {
          tools: chain,
          frequency: 1,
          successRate: 0,
          avgDuration: 0,
          lastUsed: new Date(),
        });
      }
    }
  }

  /**
   * Get statistics for a specific tool
   */
  getToolStats(toolName: string): ToolStats | undefined {
    return this.toolStats.get(toolName);
  }

  /**
   * Get all tool statistics
   */
  getAllToolStats(): ToolStats[] {
    return Array.from(this.toolStats.values());
  }

  /**
   * Get most used tools
   */
  getMostUsedTools(limit: number = 10): ToolStats[] {
    return Array.from(this.toolStats.values())
      .sort((a, b) => b.totalExecutions - a.totalExecutions)
      .slice(0, limit);
  }

  /**
   * Get tools with highest success rate (minimum 5 executions)
   */
  getHighestSuccessRate(limit: number = 10): ToolStats[] {
    return Array.from(this.toolStats.values())
      .filter(s => s.totalExecutions >= 5)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, limit);
  }

  /**
   * Get tools with lowest success rate (minimum 5 executions)
   */
  getLowestSuccessRate(limit: number = 10): ToolStats[] {
    return Array.from(this.toolStats.values())
      .filter(s => s.totalExecutions >= 5)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, limit);
  }

  /**
   * Get common tool chains
   */
  getCommonChains(limit: number = 10): ToolChain[] {
    return Array.from(this.toolChains.values())
      .filter(c => c.frequency >= 2)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  /**
   * Suggest tools based on current context and patterns
   */
  suggestTools(context?: string, lastTool?: string): ToolSuggestion[] {
    const suggestions: ToolSuggestion[] = [];

    // Suggest based on tool chains
    if (lastTool) {
      const chainSuggestions = this.suggestFromChains(lastTool);
      suggestions.push(...chainSuggestions);
    }

    // Suggest based on high success rate
    const highSuccessTools = this.getHighestSuccessRate(5);
    for (const tool of highSuccessTools) {
      if (!suggestions.some(s => s.toolName === tool.toolName)) {
        suggestions.push({
          toolName: tool.toolName,
          confidence: tool.successRate / 100,
          reason: `High success rate (${tool.successRate.toFixed(1)}%)`,
          basedOn: 'success_rate',
        });
      }
    }

    // Suggest based on frequency
    const frequentTools = this.getMostUsedTools(5);
    for (const tool of frequentTools) {
      if (!suggestions.some(s => s.toolName === tool.toolName)) {
        suggestions.push({
          toolName: tool.toolName,
          confidence: Math.min(0.9, tool.totalExecutions / 100),
          reason: `Frequently used (${tool.totalExecutions} times)`,
          basedOn: 'frequency',
        });
      }
    }

    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  }

  /**
   * Suggest next tool based on common chains
   */
  private suggestFromChains(lastTool: string): ToolSuggestion[] {
    const suggestions: ToolSuggestion[] = [];

    for (const [, chain] of this.toolChains) {
      const toolIndex = chain.tools.indexOf(lastTool);
      if (toolIndex >= 0 && toolIndex < chain.tools.length - 1) {
        const nextTool = chain.tools[toolIndex + 1];
        if (nextTool === undefined) continue;
        const existing = suggestions.find(s => s.toolName === nextTool);

        if (existing) {
          existing.confidence = Math.min(1, existing.confidence + 0.1);
        } else {
          suggestions.push({
            toolName: nextTool,
            confidence: Math.min(0.9, chain.frequency / 10),
            reason: `Common next step after ${lastTool} (${chain.frequency} occurrences)`,
            basedOn: 'pattern',
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Get analytics snapshot
   */
  getSnapshot(): ToolAnalyticsSnapshot {
    const allStats = this.getAllToolStats();
    const totalExecutions = allStats.reduce((sum, s) => sum + s.totalExecutions, 0);
    const totalSuccess = allStats.reduce((sum, s) => sum + s.successCount, 0);

    return {
      totalExecutions,
      uniqueTools: allStats.length,
      overallSuccessRate: totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 0,
      mostUsedTools: this.getMostUsedTools(5).map(t => ({ name: t.toolName, count: t.totalExecutions })),
      highestSuccessRate: this.getHighestSuccessRate(5).map(t => ({ name: t.toolName, rate: t.successRate })),
      lowestSuccessRate: this.getLowestSuccessRate(5).map(t => ({ name: t.toolName, rate: t.successRate })),
      recentChains: this.getCommonChains(5),
      period: {
        start: this.executions[0]?.timestamp || new Date(),
        end: this.executions[this.executions.length - 1]?.timestamp || new Date(),
      },
    };
  }

  /**
   * Format analytics for display
   */
  formatAnalytics(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];

    lines.push('Tool Usage Analytics');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push('Overview');
    lines.push('-'.repeat(40));
    lines.push(`Total Executions: ${snapshot.totalExecutions.toLocaleString()}`);
    lines.push(`Unique Tools: ${snapshot.uniqueTools}`);
    lines.push(`Overall Success Rate: ${snapshot.overallSuccessRate.toFixed(1)}%`);
    lines.push('');

    if (snapshot.mostUsedTools.length > 0) {
      lines.push('Most Used Tools');
      lines.push('-'.repeat(40));
      for (const tool of snapshot.mostUsedTools) {
        lines.push(`  ${tool.name}: ${tool.count} executions`);
      }
      lines.push('');
    }

    if (snapshot.highestSuccessRate.length > 0) {
      lines.push('Highest Success Rate (min 5 uses)');
      lines.push('-'.repeat(40));
      for (const tool of snapshot.highestSuccessRate) {
        lines.push(`  ${tool.name}: ${tool.rate.toFixed(1)}%`);
      }
      lines.push('');
    }

    if (snapshot.lowestSuccessRate.length > 0) {
      lines.push('Needs Improvement (min 5 uses)');
      lines.push('-'.repeat(40));
      for (const tool of snapshot.lowestSuccessRate) {
        lines.push(`  ${tool.name}: ${tool.rate.toFixed(1)}%`);
      }
      lines.push('');
    }

    if (snapshot.recentChains.length > 0) {
      lines.push('Common Tool Chains');
      lines.push('-'.repeat(40));
      for (const chain of snapshot.recentChains) {
        lines.push(`  ${chain.tools.join(' -> ')} (${chain.frequency}x)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Export analytics to JSON
   */
  exportToJson(): string {
    return JSON.stringify({
      snapshot: this.getSnapshot(),
      toolStats: this.getAllToolStats(),
      toolChains: this.getCommonChains(20),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  /**
   * Save analytics to disk
   */
  async save(): Promise<void> {
    if (!this.persistenceEnabled) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = path.join(this.dataDir, 'tool-analytics.json');
      await fs.writeFile(filePath, this.exportToJson(), 'utf-8');
      this.emit('analytics:saved', filePath);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Load analytics from disk
   */
  async load(): Promise<void> {
    if (!this.persistenceEnabled) return;

    try {
      const filePath = path.join(this.dataDir, 'tool-analytics.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Restore tool stats
      if (data.toolStats && Array.isArray(data.toolStats)) {
        for (const stat of data.toolStats) {
          this.toolStats.set(stat.toolName, {
            ...stat,
            lastUsed: new Date(stat.lastUsed),
          });
        }
      }

      // Restore tool chains
      if (data.toolChains && Array.isArray(data.toolChains)) {
        for (const chain of data.toolChains) {
          const key = chain.tools.join(' -> ');
          this.toolChains.set(key, {
            ...chain,
            lastUsed: new Date(chain.lastUsed),
          });
        }
      }

      this.emit('analytics:loaded', filePath);
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      this.emit('analytics:load_failed', error);
    }
  }

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.executions = [];
    this.toolStats.clear();
    this.toolChains.clear();
    this.recentToolSequence = [];
    this.emit('analytics:cleared');
  }

  /**
   * Reset the tool sequence (start fresh chain detection)
   */
  resetToolSequence(): void {
    this.recentToolSequence = [];
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ToolAnalytics | null = null;

/**
 * Get the global tool analytics instance
 */
export function getToolAnalytics(): ToolAnalytics {
  if (!instance) {
    instance = new ToolAnalytics();
    // Load persisted data asynchronously
    instance.load().catch(() => {
      // Ignore load errors, start fresh
    });
  }
  return instance;
}

/**
 * Reset the global tool analytics instance
 */
export function resetToolAnalytics(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}

export default ToolAnalytics;
