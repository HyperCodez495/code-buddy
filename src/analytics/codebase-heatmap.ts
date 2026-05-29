/**
 * Codebase Heatmap
 *
 * Visualize file modification patterns:
 * - Most frequently modified files
 * - Recent activity hotspots
 * - Change velocity
 * - Churn analysis
 */

import { execSync } from 'child_process';
import * as path from 'path';

export interface FileHeatData {
  filePath: string;
  commits: number;
  additions: number;
  deletions: number;
  lastModified: Date;
  authors: string[];
  churnScore: number; // additions + deletions
  heatLevel: 'cold' | 'cool' | 'warm' | 'hot' | 'burning';
}

export interface HeatmapData {
  files: FileHeatData[];
  summary: {
    totalFiles: number;
    totalCommits: number;
    totalAdditions: number;
    totalDeletions: number;
    hotspots: string[];
    coldspots: string[];
    topAuthors: Array<{ author: string; commits: number }>;
  };
  generatedAt: Date;
}

export interface HeatmapOptions {
  /** Repository path */
  repoPath?: string;
  /** Number of days to analyze */
  days?: number;
  /** Maximum files to include */
  maxFiles?: number;
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
}

const DEFAULT_OPTIONS: Required<HeatmapOptions> = {
  repoPath: process.cwd(),
  days: 90,
  maxFiles: 100,
  include: ['**/*'],
  exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '*.lock'],
};

/**
 * Generate codebase heatmap
 */
export function generateHeatmap(options: HeatmapOptions = {}): HeatmapData {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().split('T')[0] ?? since.toISOString();

  // Get file statistics from git
  const fileStats = getFileStats(opts.repoPath, sinceStr, opts.exclude);

  // Calculate heat levels
  const maxChurn = Math.max(...fileStats.map(f => f.churnScore), 1);
  const maxCommits = Math.max(...fileStats.map(f => f.commits), 1);

  for (const file of fileStats) {
    const churnRatio = file.churnScore / maxChurn;
    const commitRatio = file.commits / maxCommits;
    const heatScore = (churnRatio * 0.6) + (commitRatio * 0.4);

    if (heatScore >= 0.8) file.heatLevel = 'burning';
    else if (heatScore >= 0.6) file.heatLevel = 'hot';
    else if (heatScore >= 0.4) file.heatLevel = 'warm';
    else if (heatScore >= 0.2) file.heatLevel = 'cool';
    else file.heatLevel = 'cold';
  }

  // Sort by heat (churn score)
  fileStats.sort((a, b) => b.churnScore - a.churnScore);

  // Limit files
  const limitedFiles = fileStats.slice(0, opts.maxFiles);

  // Calculate summary
  const summary = calculateSummary(limitedFiles);

  return {
    files: limitedFiles,
    summary,
    generatedAt: new Date(),
  };
}

/**
 * Get file statistics from git
 */
function getFileStats(
  repoPath: string,
  since: string,
  exclude: string[]
): FileHeatData[] {
  const files = new Map<string, FileHeatData>();

  try {
    // Get file change counts
    const logOutput = execSync(
      `git log --since="${since}" --name-only --pretty=format:"%H|%an|%aI" --no-merges`,
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    let currentCommit: { hash: string; author: string; date: Date } | null = null;

    for (const line of logOutput.split('\n')) {
      if (line.includes('|')) {
        const [hash, author, dateStr] = line.split('|');
        if (hash === undefined || author === undefined || dateStr === undefined) {
          continue;
        }
        currentCommit = { hash, author, date: new Date(dateStr) };
      } else if (line.trim() && currentCommit) {
        const filePath = line.trim();

        // Skip excluded patterns
        if (shouldExclude(filePath, exclude)) continue;

        if (!files.has(filePath)) {
          files.set(filePath, {
            filePath,
            commits: 0,
            additions: 0,
            deletions: 0,
            lastModified: currentCommit.date,
            authors: [],
            churnScore: 0,
            heatLevel: 'cold',
          });
        }

        const file = files.get(filePath)!;
        file.commits++;

        if (!file.authors.includes(currentCommit.author)) {
          file.authors.push(currentCommit.author);
        }

        if (currentCommit.date > file.lastModified) {
          file.lastModified = currentCommit.date;
        }
      }
    }

    // Get line change statistics
    const numstatOutput = execSync(
      `git log --since="${since}" --numstat --pretty=format:"" --no-merges`,
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    for (const line of numstatOutput.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const [additions, deletions, filePath] = parts;
        if (additions === undefined || deletions === undefined || filePath === undefined) {
          continue;
        }
        const add = parseInt(additions, 10) || 0;
        const del = parseInt(deletions, 10) || 0;

        const file = files.get(filePath);
        if (file) {
          file.additions += add;
          file.deletions += del;
          file.churnScore = file.additions + file.deletions;
        }
      }
    }
  } catch {
    // Git command failed
  }

  return Array.from(files.values());
}

/**
 * Check if file should be excluded
 */
function shouldExclude(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching
    const regex = new RegExp(
      '^' + pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.') + '$'
    );

    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate summary statistics
 */
function calculateSummary(files: FileHeatData[]): HeatmapData['summary'] {
  const authorCounts = new Map<string, number>();

  for (const file of files) {
    for (const author of file.authors) {
      authorCounts.set(author, (authorCounts.get(author) || 0) + file.commits);
    }
  }

  const topAuthors = Array.from(authorCounts.entries())
    .map(([author, commits]) => ({ author, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);

  return {
    totalFiles: files.length,
    totalCommits: files.reduce((sum, f) => sum + f.commits, 0),
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    hotspots: files.filter(f => f.heatLevel === 'burning' || f.heatLevel === 'hot')
      .slice(0, 5)
      .map(f => f.filePath),
    coldspots: files.filter(f => f.heatLevel === 'cold')
      .slice(-5)
      .map(f => f.filePath),
    topAuthors,
  };
}

/**
 * Format heatmap for terminal display
 */
export function formatHeatmap(data: HeatmapData): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('                              CODEBASE HEATMAP');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  lines.push(`  Files Analyzed:     ${data.summary.totalFiles}`);
  lines.push(`  Total Commits:      ${data.summary.totalCommits}`);
  lines.push(`  Lines Added:        +${data.summary.totalAdditions.toLocaleString()}`);
  lines.push(`  Lines Deleted:      -${data.summary.totalDeletions.toLocaleString()}`);
  lines.push('');

  // Hotspots
  if (data.summary.hotspots.length > 0) {
    lines.push('🔥 HOTSPOTS (Most Active Files)');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    for (const file of data.summary.hotspots) {
      lines.push(`  ${file}`);
    }
    lines.push('');
  }

  // Heatmap visualization
  lines.push('FILE ACTIVITY HEATMAP');
  lines.push('───────────────────────────────────────────────────────────────────────────────');

  const heatIcons: Record<FileHeatData['heatLevel'], string> = {
    burning: '🔥',
    hot: '🟥',
    warm: '🟧',
    cool: '🟨',
    cold: '⬜',
  };

  for (const file of data.files.slice(0, 20)) {
    const icon = heatIcons[file.heatLevel];
    const name = file.filePath.length > 50
      ? '...' + file.filePath.slice(-47)
      : file.filePath.padEnd(50);
    const stats = `${file.commits} commits  +${file.additions}/-${file.deletions}`;

    lines.push(`  ${icon} ${name}  ${stats}`);
  }

  if (data.files.length > 20) {
    lines.push(`  ... and ${data.files.length - 20} more files`);
  }

  lines.push('');

  // Top contributors
  if (data.summary.topAuthors.length > 0) {
    lines.push('TOP CONTRIBUTORS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    for (const { author, commits } of data.summary.topAuthors.slice(0, 5)) {
      lines.push(`  ${author.padEnd(30)} ${commits} commits`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push(`Generated: ${data.generatedAt.toLocaleString()}`);

  return lines.join('\n');
}

/**
 * Get directory-level heatmap
 */
export function getDirectoryHeatmap(data: HeatmapData): Map<string, number> {
  const dirs = new Map<string, number>();

  for (const file of data.files) {
    const dir = path.dirname(file.filePath);
    dirs.set(dir, (dirs.get(dir) || 0) + file.churnScore);
  }

  return new Map(
    Array.from(dirs.entries())
      .sort((a, b) => b[1] - a[1])
  );
}

export default generateHeatmap;
