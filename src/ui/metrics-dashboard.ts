/**
 * Local Metrics Dashboard
 *
 * Visual dashboard for tracking metrics:
 * - Session statistics
 * - Cost tracking
 * - Performance metrics
 * - Usage patterns
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  messageCount: number;
  toolCalls: number;
  tokensUsed: number;
  cost: number;
  errors: number;
}

export interface DailyMetrics {
  date: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokensUsed: number;
  cost: number;
  errors: number;
  avgSessionDuration: number;
}

export interface ToolMetrics {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  avgDuration: number;
  totalDuration: number;
}

export interface DashboardData {
  summary: {
    totalSessions: number;
    totalMessages: number;
    totalToolCalls: number;
    totalTokens: number;
    totalCost: number;
    totalErrors: number;
    avgSessionDuration: number;
    avgMessagesPerSession: number;
  };
  daily: DailyMetrics[];
  tools: ToolMetrics[];
  recentSessions: SessionMetrics[];
  trends: {
    costTrend: 'up' | 'down' | 'stable';
    usageTrend: 'up' | 'down' | 'stable';
    errorTrend: 'up' | 'down' | 'stable';
  };
}

/**
 * Metrics Dashboard Manager
 */
export class MetricsDashboard {
  private metricsPath: string;
  private sessions: SessionMetrics[] = [];
  private toolMetrics: Map<string, ToolMetrics> = new Map();

  constructor(metricsPath?: string) {
    this.metricsPath = metricsPath || path.join(os.homedir(), '.codebuddy', 'metrics.json');
    this.loadMetrics();
  }

  /**
   * Record session start
   */
  startSession(sessionId: string): void {
    this.sessions.push({
      sessionId,
      startTime: new Date(),
      messageCount: 0,
      toolCalls: 0,
      tokensUsed: 0,
      cost: 0,
      errors: 0,
    });
    this.saveMetrics();
  }

  /**
   * Record session end
   */
  endSession(sessionId: string): void {
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.endTime = new Date();
      this.saveMetrics();
    }
  }

  /**
   * Record message
   */
  recordMessage(sessionId: string, tokens: number, cost: number): void {
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.messageCount++;
      session.tokensUsed += tokens;
      session.cost += cost;
      this.saveMetrics();
    }
  }

  /**
   * Record tool call
   */
  recordToolCall(
    sessionId: string,
    toolName: string,
    success: boolean,
    duration: number
  ): void {
    // Update session
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.toolCalls++;
      if (!success) session.errors++;
    }

    // Update tool metrics
    let tool = this.toolMetrics.get(toolName);
    if (!tool) {
      tool = {
        name: toolName,
        calls: 0,
        successes: 0,
        failures: 0,
        avgDuration: 0,
        totalDuration: 0,
      };
      this.toolMetrics.set(toolName, tool);
    }

    tool.calls++;
    if (success) {
      tool.successes++;
    } else {
      tool.failures++;
    }
    tool.totalDuration += duration;
    tool.avgDuration = tool.totalDuration / tool.calls;

    this.saveMetrics();
  }

  /**
   * Get dashboard data
   */
  getDashboardData(days: number = 30): DashboardData {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentSessions = this.sessions.filter(s => s.startTime >= cutoff);

    // Calculate summary
    const summary = this.calculateSummary(recentSessions);

    // Calculate daily metrics
    const daily = this.calculateDailyMetrics(recentSessions, days);

    // Get tool metrics
    const tools = Array.from(this.toolMetrics.values())
      .sort((a, b) => b.calls - a.calls);

    // Calculate trends
    const trends = this.calculateTrends(daily);

    return {
      summary,
      daily,
      tools,
      recentSessions: recentSessions.slice(-10).reverse(),
      trends,
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(sessions: SessionMetrics[]): DashboardData['summary'] {
    let totalDuration = 0;

    for (const session of sessions) {
      if (session.endTime) {
        totalDuration += session.endTime.getTime() - session.startTime.getTime();
      }
    }

    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
    const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolCalls, 0);
    const totalTokens = sessions.reduce((sum, s) => sum + s.tokensUsed, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
    const totalErrors = sessions.reduce((sum, s) => sum + s.errors, 0);

    return {
      totalSessions,
      totalMessages,
      totalToolCalls,
      totalTokens,
      totalCost,
      totalErrors,
      avgSessionDuration: totalSessions > 0 ? totalDuration / totalSessions / 1000 / 60 : 0, // minutes
      avgMessagesPerSession: totalSessions > 0 ? totalMessages / totalSessions : 0,
    };
  }

  /**
   * Calculate daily metrics
   */
  private calculateDailyMetrics(sessions: SessionMetrics[], days: number): DailyMetrics[] {
    const dailyMap = new Map<string, DailyMetrics>();

    // Initialize all days
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0] ?? date.toISOString();
      dailyMap.set(dateStr, {
        date: dateStr,
        sessions: 0,
        messages: 0,
        toolCalls: 0,
        tokensUsed: 0,
        cost: 0,
        errors: 0,
        avgSessionDuration: 0,
      });
    }

    // Aggregate sessions
    for (const session of sessions) {
      const dateStr = session.startTime.toISOString().split('T')[0] ?? session.startTime.toISOString();
      const daily = dailyMap.get(dateStr);
      if (daily) {
        daily.sessions++;
        daily.messages += session.messageCount;
        daily.toolCalls += session.toolCalls;
        daily.tokensUsed += session.tokensUsed;
        daily.cost += session.cost;
        daily.errors += session.errors;

        if (session.endTime) {
          const duration = (session.endTime.getTime() - session.startTime.getTime()) / 1000 / 60;
          daily.avgSessionDuration =
            (daily.avgSessionDuration * (daily.sessions - 1) + duration) / daily.sessions;
        }
      }
    }

    return Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate trends
   */
  private calculateTrends(daily: DailyMetrics[]): DashboardData['trends'] {
    if (daily.length < 7) {
      return { costTrend: 'stable', usageTrend: 'stable', errorTrend: 'stable' };
    }

    const recent = daily.slice(-7);
    const older = daily.slice(-14, -7);

    const recentCost = recent.reduce((sum, d) => sum + d.cost, 0);
    const olderCost = older.reduce((sum, d) => sum + d.cost, 0);

    const recentUsage = recent.reduce((sum, d) => sum + d.messages, 0);
    const olderUsage = older.reduce((sum, d) => sum + d.messages, 0);

    const recentErrors = recent.reduce((sum, d) => sum + d.errors, 0);
    const olderErrors = older.reduce((sum, d) => sum + d.errors, 0);

    return {
      costTrend: this.getTrend(recentCost, olderCost),
      usageTrend: this.getTrend(recentUsage, olderUsage),
      errorTrend: this.getTrend(recentErrors, olderErrors),
    };
  }

  /**
   * Get trend direction
   */
  private getTrend(recent: number, older: number): 'up' | 'down' | 'stable' {
    const threshold = 0.1; // 10% change
    const change = older > 0 ? (recent - older) / older : 0;

    if (change > threshold) return 'up';
    if (change < -threshold) return 'down';
    return 'stable';
  }

  /**
   * Format dashboard for terminal display
   */
  formatDashboard(days: number = 30): string {
    const data = this.getDashboardData(days);
    const lines: string[] = [];

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push('                              METRICS DASHBOARD');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    lines.push('SUMMARY (Last ' + days + ' days)');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(`  Sessions:           ${data.summary.totalSessions}`);
    lines.push(`  Messages:           ${data.summary.totalMessages}`);
    lines.push(`  Tool Calls:         ${data.summary.totalToolCalls}`);
    lines.push(`  Tokens Used:        ${data.summary.totalTokens.toLocaleString()}`);
    lines.push(`  Total Cost:         $${data.summary.totalCost.toFixed(4)}`);
    lines.push(`  Errors:             ${data.summary.totalErrors}`);
    lines.push(`  Avg Session:        ${data.summary.avgSessionDuration.toFixed(1)} min`);
    lines.push(`  Avg Msgs/Session:   ${data.summary.avgMessagesPerSession.toFixed(1)}`);
    lines.push('');

    // Trends
    lines.push('TRENDS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    const trendIcons = { up: '↑', down: '↓', stable: '→' };
    lines.push(`  Cost:    ${trendIcons[data.trends.costTrend]} ${data.trends.costTrend}`);
    lines.push(`  Usage:   ${trendIcons[data.trends.usageTrend]} ${data.trends.usageTrend}`);
    lines.push(`  Errors:  ${trendIcons[data.trends.errorTrend]} ${data.trends.errorTrend}`);
    lines.push('');

    // Top Tools
    if (data.tools.length > 0) {
      lines.push('TOP TOOLS');
      lines.push('───────────────────────────────────────────────────────────────────────────────');
      for (const tool of data.tools.slice(0, 5)) {
        const successRate = tool.calls > 0 ? (tool.successes / tool.calls * 100).toFixed(0) : 0;
        lines.push(`  ${tool.name.padEnd(20)} ${tool.calls} calls  ${successRate}% success  ${tool.avgDuration.toFixed(0)}ms avg`);
      }
      lines.push('');
    }

    // Daily Chart (simple ASCII)
    if (data.daily.length > 0) {
      lines.push('DAILY USAGE (Last 14 days)');
      lines.push('───────────────────────────────────────────────────────────────────────────────');
      const recent14 = data.daily.slice(-14);
      const maxMessages = Math.max(...recent14.map(d => d.messages), 1);

      for (const day of recent14) {
        const barLength = Math.round((day.messages / maxMessages) * 40);
        const bar = '█'.repeat(barLength) + '░'.repeat(40 - barLength);
        const dateShort = day.date.slice(5); // MM-DD
        lines.push(`  ${dateShort} ${bar} ${day.messages}`);
      }
      lines.push('');
    }

    // Recent Sessions
    if (data.recentSessions.length > 0) {
      lines.push('RECENT SESSIONS');
      lines.push('───────────────────────────────────────────────────────────────────────────────');
      for (const session of data.recentSessions.slice(0, 5)) {
        const time = session.startTime.toLocaleString();
        lines.push(`  ${time}  ${session.messageCount} msgs  ${session.toolCalls} tools  $${session.cost.toFixed(4)}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Export data as JSON
   */
  exportData(): string {
    return JSON.stringify(this.getDashboardData(), null, 2);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.sessions = [];
    this.toolMetrics.clear();
    this.saveMetrics();
  }

  /**
   * Load metrics from file
   */
  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const data = fs.readJsonSync(this.metricsPath);

        if (data.sessions) {
          this.sessions = data.sessions.map((s: Record<string, unknown>) => ({
            ...s,
            startTime: new Date(s.startTime as string),
            endTime: s.endTime ? new Date(s.endTime as string) : undefined,
          }));
        }

        if (data.tools) {
          for (const tool of data.tools) {
            this.toolMetrics.set(tool.name, tool);
          }
        }
      }
    } catch {
      this.sessions = [];
    }
  }

  /**
   * Save metrics to file
   */
  private saveMetrics(): void {
    try {
      fs.ensureDirSync(path.dirname(this.metricsPath));
      fs.writeJsonSync(this.metricsPath, {
        sessions: this.sessions,
        tools: Array.from(this.toolMetrics.values()),
      }, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let dashboard: MetricsDashboard | null = null;

/**
 * Get or create metrics dashboard
 */
export function getMetricsDashboard(): MetricsDashboard {
  if (!dashboard) {
    dashboard = new MetricsDashboard();
  }
  return dashboard;
}

export default MetricsDashboard;
