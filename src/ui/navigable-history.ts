/**
 * Navigable History
 *
 * Provides keyboard-navigable command history:
 * - Up/Down arrow navigation
 * - Search through history
 * - Persistent storage
 * - Session-aware history
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface HistoryEntry {
  command: string;
  timestamp: Date;
  sessionId?: string;
  success?: boolean;
  duration?: number;
}

export interface NavigableHistoryOptions {
  /** Maximum entries to keep */
  maxEntries?: number;
  /** Path to history file */
  historyPath?: string;
  /** Enable persistence */
  persist?: boolean;
  /** Session ID for filtering */
  sessionId?: string;
  /** Deduplicate consecutive entries */
  deduplicate?: boolean;
}

const DEFAULT_OPTIONS: Required<NavigableHistoryOptions> = {
  maxEntries: 1000,
  historyPath: path.join(os.homedir(), '.codebuddy', 'command-history.json'),
  persist: true,
  sessionId: '',
  deduplicate: true,
};

/**
 * Navigable History Manager
 */
export class NavigableHistory {
  private entries: HistoryEntry[] = [];
  private currentIndex: number = -1;
  private tempEntry: string = '';
  private options: Required<NavigableHistoryOptions>;
  private searchMode: boolean = false;
  private searchQuery: string = '';
  private searchResults: number[] = [];
  private searchResultIndex: number = -1;

  constructor(options: NavigableHistoryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (this.options.persist) {
      this.load();
    }
  }

  /**
   * Add entry to history
   */
  add(command: string, metadata?: Partial<Omit<HistoryEntry, 'command' | 'timestamp'>>): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Deduplicate consecutive entries
    if (this.options.deduplicate && this.entries.length > 0) {
      const lastEntry = this.entries[this.entries.length - 1];
      if (lastEntry && lastEntry.command === trimmed) {
        // Update timestamp of existing entry
        lastEntry.timestamp = new Date();
        if (metadata) {
          Object.assign(lastEntry, metadata);
        }
        this.save();
        return;
      }
    }

    const entry: HistoryEntry = {
      command: trimmed,
      timestamp: new Date(),
      sessionId: this.options.sessionId || undefined,
      ...metadata,
    };

    this.entries.push(entry);

    // Trim if exceeded max
    if (this.entries.length > this.options.maxEntries) {
      this.entries = this.entries.slice(-this.options.maxEntries);
    }

    // Reset navigation
    this.resetNavigation();
    this.save();
  }

  /**
   * Navigate to previous entry (up arrow)
   */
  previous(currentInput: string): string | null {
    if (this.entries.length === 0) return null;

    // If at initial position, save current input
    if (this.currentIndex === -1) {
      this.tempEntry = currentInput;
    }

    // Move up in history
    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex++;
      const entry = this.entries[this.entries.length - 1 - this.currentIndex];
      return entry ? entry.command : null;
    }

    // Already at oldest entry
    const oldest = this.entries[0];
    return oldest ? oldest.command : null;
  }

  /**
   * Navigate to next entry (down arrow)
   */
  next(): string | null {
    if (this.entries.length === 0 || this.currentIndex < 0) return null;

    // Move down in history
    this.currentIndex--;

    if (this.currentIndex < 0) {
      // Back to initial input
      this.currentIndex = -1;
      return this.tempEntry;
    }

    const entry = this.entries[this.entries.length - 1 - this.currentIndex];
    return entry ? entry.command : null;
  }

  /**
   * Start search mode
   */
  startSearch(): void {
    this.searchMode = true;
    this.searchQuery = '';
    this.searchResults = [];
    this.searchResultIndex = -1;
  }

  /**
   * Update search query
   */
  updateSearch(query: string): HistoryEntry[] {
    this.searchQuery = query.toLowerCase();

    if (!this.searchQuery) {
      this.searchResults = [];
      return [];
    }

    // Find matching entries
    this.searchResults = [];
    const matches: HistoryEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry && entry.command.toLowerCase().includes(this.searchQuery)) {
        this.searchResults.push(i);
        matches.push(entry);
      }
    }

    this.searchResultIndex = this.searchResults.length > 0 ? 0 : -1;
    return matches;
  }

  /**
   * Get current search result
   */
  getCurrentSearchResult(): HistoryEntry | null {
    if (this.searchResultIndex < 0 || this.searchResults.length === 0) {
      return null;
    }
    const entryIndex = this.searchResults[this.searchResultIndex];
    if (entryIndex === undefined) {
      return null;
    }
    return this.entries[entryIndex] ?? null;
  }

  /**
   * Navigate to next search result
   */
  nextSearchResult(): HistoryEntry | null {
    if (this.searchResults.length === 0) return null;

    this.searchResultIndex = (this.searchResultIndex + 1) % this.searchResults.length;
    return this.getCurrentSearchResult();
  }

  /**
   * Navigate to previous search result
   */
  previousSearchResult(): HistoryEntry | null {
    if (this.searchResults.length === 0) return null;

    this.searchResultIndex = this.searchResultIndex <= 0
      ? this.searchResults.length - 1
      : this.searchResultIndex - 1;
    return this.getCurrentSearchResult();
  }

  /**
   * End search mode
   */
  endSearch(): void {
    this.searchMode = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.searchResultIndex = -1;
  }

  /**
   * Check if in search mode
   */
  isSearching(): boolean {
    return this.searchMode;
  }

  /**
   * Get search info for display
   */
  getSearchInfo(): { query: string; current: number; total: number } {
    return {
      query: this.searchQuery,
      current: this.searchResultIndex + 1,
      total: this.searchResults.length,
    };
  }

  /**
   * Reset navigation position
   */
  resetNavigation(): void {
    this.currentIndex = -1;
    this.tempEntry = '';
  }

  /**
   * Get all entries
   */
  getAll(): HistoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get recent entries
   */
  getRecent(count: number = 10): HistoryEntry[] {
    return this.entries.slice(-count).reverse();
  }

  /**
   * Get entries for current session
   */
  getSessionHistory(): HistoryEntry[] {
    if (!this.options.sessionId) return this.entries;
    return this.entries.filter(e => e.sessionId === this.options.sessionId);
  }

  /**
   * Get unique commands (deduplicated)
   */
  getUniqueCommands(): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry) continue;
      const cmd = entry.command;
      if (!seen.has(cmd)) {
        seen.add(cmd);
        unique.push(cmd);
      }
    }

    return unique;
  }

  /**
   * Get frequently used commands
   */
  getFrequent(limit: number = 10): Array<{ command: string; count: number }> {
    const counts = new Map<string, number>();

    for (const entry of this.entries) {
      counts.set(entry.command, (counts.get(entry.command) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Clear history
   */
  clear(): void {
    this.entries = [];
    this.resetNavigation();
    this.save();
  }

  /**
   * Clear old entries
   */
  clearOlderThan(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const original = this.entries.length;

    this.entries = this.entries.filter(e => e.timestamp.getTime() >= cutoff);

    const removed = original - this.entries.length;
    if (removed > 0) this.save();

    return removed;
  }

  /**
   * Get entry count
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Get current navigation position
   */
  get position(): number {
    return this.currentIndex;
  }

  /**
   * Check if at beginning of history
   */
  isAtStart(): boolean {
    return this.currentIndex === -1;
  }

  /**
   * Check if at end of history
   */
  isAtEnd(): boolean {
    return this.currentIndex >= this.entries.length - 1;
  }

  /**
   * Format history for display
   */
  format(limit: number = 20): string {
    const recent = this.getRecent(limit);

    if (recent.length === 0) {
      return 'No history available.';
    }

    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════════════',
      '              COMMAND HISTORY',
      '═══════════════════════════════════════════════════════════',
      '',
    ];

    for (let i = 0; i < recent.length; i++) {
      const entry = recent[i];
      if (!entry) continue;
      const time = entry.timestamp.toLocaleTimeString();
      const truncated = entry.command.length > 60
        ? entry.command.slice(0, 57) + '...'
        : entry.command;

      const marker = i === (this.currentIndex === -1 ? -1 : this.entries.length - 1 - this.currentIndex)
        ? '>' : ' ';

      lines.push(`${marker} ${(i + 1).toString().padStart(2)} [${time}] ${truncated}`);
    }

    lines.push('');
    lines.push(`Total: ${this.entries.length} entries`);
    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Load history from file
   */
  private load(): void {
    try {
      if (fs.existsSync(this.options.historyPath)) {
        const data = fs.readJsonSync(this.options.historyPath);
        if (Array.isArray(data)) {
          this.entries = data.map(e => ({
            ...e,
            timestamp: new Date(e.timestamp),
          }));
        }
      }
    } catch {
      // Start with empty history
      this.entries = [];
    }
  }

  /**
   * Save history to file
   */
  private save(): void {
    if (!this.options.persist) return;

    try {
      fs.ensureDirSync(path.dirname(this.options.historyPath));
      fs.writeJsonSync(this.options.historyPath, this.entries, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Export history
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Import history
   */
  import(json: string, merge: boolean = true): boolean {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data)) return false;

      const entries = data.map(e => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }));

      if (merge) {
        this.entries = [...this.entries, ...entries];
        // Deduplicate by timestamp
        const seen = new Set<number>();
        this.entries = this.entries.filter(e => {
          const key = e.timestamp.getTime();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        this.entries = entries;
      }

      // Trim to max
      if (this.entries.length > this.options.maxEntries) {
        this.entries = this.entries.slice(-this.options.maxEntries);
      }

      this.save();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let historyInstance: NavigableHistory | null = null;

/**
 * Get or create navigable history instance
 */
export function getNavigableHistory(options?: NavigableHistoryOptions): NavigableHistory {
  if (!historyInstance) {
    historyInstance = new NavigableHistory(options);
  }
  return historyInstance;
}

export default NavigableHistory;
