/**
 * Memory Context Builder Module
 *
 * Manages memory integration and context building for the agent.
 * Handles:
 * - Memory retrieval and relevance filtering
 * - Context window management
 * - Memory persistence and project context
 * - Cross-session context building
 *
 * @module agent/context
 */

import { EventEmitter } from "events";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../errors/index.js";
import {
  EnhancedMemory,
  getEnhancedMemory,
  type MemoryEntry,
  type MemoryType,
  type MemoryConfig,
  type MemorySearchOptions,
} from "../../memory/index.js";

/**
 * Configuration for the MemoryContextBuilder
 */
export interface MemoryContextConfig {
  /** Whether memory system is enabled. Default: true */
  enabled: boolean;
  /** Maximum memories to include in context. Default: 10 */
  maxContextMemories: number;
  /** Minimum importance score for inclusion. Default: 0.5 */
  minImportanceScore: number;
  /** Whether to auto-save conversation to memory. Default: true */
  autoSave: boolean;
  /** Types of memories to include in context */
  includedTypes: MemoryType[];
  /** Project context path */
  projectPath?: string;
  /** Enhanced memory configuration */
  memoryConfig?: Partial<MemoryConfig>;
}

/**
 * Default configuration
 */
export const DEFAULT_MEMORY_CONTEXT_CONFIG: MemoryContextConfig = {
  enabled: true,
  maxContextMemories: 10,
  minImportanceScore: 0.5,
  autoSave: true,
  includedTypes: ["fact", "decision", "pattern", "error"],
};

/**
 * Context item built from memory
 */
export interface ContextItem {
  /** Unique identifier */
  id: string;
  /** Memory type */
  type: MemoryType;
  /** Content of the memory */
  content: string;
  /** Importance score (0-1) */
  importance: number;
  /** When the memory was created */
  createdAt: Date;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Built context result
 */
export interface BuiltContext {
  /** Context items to include */
  items: ContextItem[];
  /** Total token estimate for the context */
  estimatedTokens: number;
  /** Summary of context sources */
  sources: {
    type: MemoryType;
    count: number;
  }[];
  /** Whether context was truncated due to limits */
  truncated: boolean;
}

/**
 * Events emitted by MemoryContextBuilder
 */
export interface MemoryContextEvents {
  "context:built": { itemCount: number; estimatedTokens: number };
  "memory:saved": { type: MemoryType; id: string };
  "memory:retrieved": { count: number; query: string };
  "project:set": { path: string };
  "error": { operation: string; error: string };
}

/**
 * MemoryContextBuilder - Manages memory integration for agent context
 *
 * This class builds relevant context from the memory system for
 * inclusion in agent conversations. It handles:
 * - Semantic search across memories
 * - Importance filtering and ranking
 * - Token budget management
 * - Project-specific context
 *
 * @example
 * ```typescript
 * const builder = new MemoryContextBuilder({
 *   enabled: true,
 *   maxContextMemories: 10
 * });
 *
 * await builder.setProjectContext("/path/to/project");
 *
 * const context = await builder.buildContext("How do I fix authentication?");
 * console.log(context.items);
 * ```
 */
export class MemoryContextBuilder extends EventEmitter {
  private config: MemoryContextConfig;
  private memory: EnhancedMemory | null = null;
  private initialized: boolean = false;

  constructor(config: Partial<MemoryContextConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MEMORY_CONTEXT_CONFIG, ...config };
  }

  /**
   * Initialize the memory system lazily
   */
  private getMemory(): EnhancedMemory {
    if (!this.memory) {
      this.memory = getEnhancedMemory({
        enabled: this.config.enabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
        ...this.config.memoryConfig,
      });

      this.initialized = true;
    }
    return this.memory;
  }

  /**
   * Set the project context for memory operations
   */
  async setProjectContext(projectPath: string): Promise<void> {
    try {
      const memory = this.getMemory();
      await memory.setProjectContext(projectPath);
      this.config.projectPath = projectPath;
      this.emit("project:set", { path: projectPath });
      logger.debug("Project context set for memory", { path: projectPath });
    } catch (error) {
      logger.warn("Failed to set project context for memory", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "setProjectContext",
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Build context from memory for a given query
   *
   * @param query - The user's query or message
   * @param tokenBudget - Optional token budget to respect
   * @returns Built context with relevant memories
   */
  async buildContext(
    query: string,
    tokenBudget?: number
  ): Promise<BuiltContext> {
    if (!this.config.enabled) {
      return {
        items: [],
        estimatedTokens: 0,
        sources: [],
        truncated: false,
      };
    }

    try {
      const memory = this.getMemory();

      // Search for relevant memories using recall with query
      const searchOptions: MemorySearchOptions = {
        query,
        limit: this.config.maxContextMemories * 2, // Get extra for filtering
        types: this.config.includedTypes,
        minImportance: this.config.minImportanceScore,
      };

      const results = await memory.recall(searchOptions);

      this.emit("memory:retrieved", { count: results.length, query });

      // Convert to context items
      const items: ContextItem[] = results.map((entry: MemoryEntry) => ({
        id: entry.id,
        type: entry.type,
        content: entry.content,
        importance: entry.importance,
        createdAt: entry.createdAt,
        metadata: entry.metadata,
      }));

      // Sort by importance
      items.sort((a, b) => b.importance - a.importance);

      // Apply token budget if specified
      let truncated = false;
      let estimatedTokens = 0;
      const selectedItems: ContextItem[] = [];
      const sourceCount = new Map<MemoryType, number>();

      for (const item of items) {
        if (selectedItems.length >= this.config.maxContextMemories) {
          truncated = true;
          break;
        }

        // Rough token estimate (4 chars per token)
        const itemTokens = Math.ceil(item.content.length / 4);

        if (tokenBudget && estimatedTokens + itemTokens > tokenBudget) {
          truncated = true;
          break;
        }

        selectedItems.push(item);
        estimatedTokens += itemTokens;

        // Track source types
        const count = sourceCount.get(item.type) || 0;
        sourceCount.set(item.type, count + 1);
      }

      // Build sources summary
      const sources = Array.from(sourceCount.entries()).map(([type, count]) => ({
        type,
        count,
      }));

      this.emit("context:built", {
        itemCount: selectedItems.length,
        estimatedTokens,
      });

      return {
        items: selectedItems,
        estimatedTokens,
        sources,
        truncated,
      };
    } catch (error) {
      logger.warn("Failed to build memory context", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "buildContext",
        error: getErrorMessage(error),
      });

      return {
        items: [],
        estimatedTokens: 0,
        sources: [],
        truncated: false,
      };
    }
  }

  /**
   * Format context items for inclusion in system prompt
   */
  formatContextForPrompt(context: BuiltContext): string {
    if (context.items.length === 0) {
      return "";
    }

    const lines: string[] = [
      "## Relevant Context from Memory",
      "",
    ];

    for (const item of context.items) {
      const typeEmoji = this.getTypeEmoji(item.type);
      lines.push(`${typeEmoji} **${item.type}** (importance: ${(item.importance * 100).toFixed(0)}%)`);
      lines.push(item.content);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Get emoji for memory type
   */
  private getTypeEmoji(type: MemoryType): string {
    const emojis: Record<MemoryType, string> = {
      fact: "📌",
      decision: "🎯",
      pattern: "🔄",
      error: "🔧",
      preference: "⚙️",
      context: "📎",
      summary: "📝",
      instruction: "📋",
      definition: "📖",
    };
    return emojis[type] || "📝";
  }

  /**
   * Save a memory entry
   */
  async saveMemory(
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.config.enabled || !this.config.autoSave) {
      return null;
    }

    try {
      const memory = this.getMemory();
      const entry = await memory.store({
        content,
        type,
        metadata,
      });

      this.emit("memory:saved", { type, id: entry.id });
      logger.debug("Memory saved", { type, id: entry.id });

      return entry.id;
    } catch (error) {
      logger.warn("Failed to save memory", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "saveMemory",
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Save a conversation exchange to memory
   */
  async saveConversation(
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    const content = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
    return this.saveMemory(content, "summary", {
      userMessage,
      assistantResponse,
    });
  }

  /**
   * Save a code pattern to memory
   */
  async saveCodePattern(
    code: string,
    language: string,
    description?: string
  ): Promise<string | null> {
    const content = description
      ? `${description}\n\`\`\`${language}\n${code}\n\`\`\``
      : `\`\`\`${language}\n${code}\n\`\`\``;

    return this.saveMemory(content, "pattern", {
      language,
      description,
    });
  }

  /**
   * Save an error solution to memory
   */
  async saveErrorSolution(
    error: string,
    solution: string,
    context?: string
  ): Promise<string | null> {
    const content = `Error: ${error}\nSolution: ${solution}${
      context ? `\nContext: ${context}` : ""
    }`;

    return this.saveMemory(content, "error", {
      error,
      solution,
      context,
    });
  }

  /**
   * Save a decision to memory
   */
  async saveDecision(
    decision: string,
    reasoning?: string
  ): Promise<string | null> {
    const content = reasoning
      ? `Decision: ${decision}\nReasoning: ${reasoning}`
      : `Decision: ${decision}`;

    return this.saveMemory(content, "decision", { reasoning });
  }

  /**
   * Get memory statistics
   */
  getStatistics(): {
    totalMemories: number;
    byType: Record<string, number>;
    projects: number;
    summaries: number;
  } | null {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const memory = this.getMemory();
      return memory.getStats();
    } catch (error) {
      logger.warn("Failed to get memory statistics", {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Clear all memories
   */
  async clearMemories(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const memory = this.getMemory();
      await memory.clear();
      logger.info("All memories cleared");
      return true;
    } catch (error) {
      logger.warn("Failed to clear memories", {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryContextConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryContextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if memory is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable memory
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
    if (this.memory) {
      this.memory.dispose();
      this.memory = null;
    }
    this.initialized = false;
  }
}

/**
 * Create a MemoryContextBuilder instance
 */
export function createMemoryContextBuilder(
  config?: Partial<MemoryContextConfig>
): MemoryContextBuilder {
  return new MemoryContextBuilder(config);
}

// Singleton instance
let builderInstance: MemoryContextBuilder | null = null;

/**
 * Get global MemoryContextBuilder instance
 */
export function getMemoryContextBuilder(
  config?: Partial<MemoryContextConfig>
): MemoryContextBuilder {
  if (!builderInstance) {
    builderInstance = createMemoryContextBuilder(config);
  }
  return builderInstance;
}

/**
 * Reset global MemoryContextBuilder
 */
export function resetMemoryContextBuilder(): void {
  if (builderInstance) {
    builderInstance.dispose();
  }
  builderInstance = null;
}

// ============================================================================
// Smart Suggestions Module
// ============================================================================

/**
 * User input pattern for suggestion learning
 */
export interface InputPattern {
  keywords: string[];
  suggestedTools: string[];
  frequency: number;
  successRate: number;
  lastUsed: Date;
}

/**
 * Tool suggestion based on input analysis
 */
export interface SmartSuggestion {
  toolName: string;
  confidence: number;
  reason: string;
  basedOn: 'keyword' | 'pattern' | 'history' | 'context';
}

/**
 * Smart Suggestions Manager
 *
 * Learns from user input patterns and successful tool chains
 * to provide intelligent tool suggestions.
 */
export class SmartSuggestionsManager extends EventEmitter {
  private patterns: Map<string, InputPattern> = new Map();
  private toolChainHistory: Array<{ tools: string[]; success: boolean; timestamp: Date }> = [];
  private maxHistory: number = 500;
  private keywordToolMap: Map<string, string[]>;

  constructor() {
    super();
    // Initialize common keyword -> tool mappings
    this.keywordToolMap = new Map([
      ['read', ['read_file', 'list_directory']],
      ['file', ['read_file', 'write_file', 'edit_file']],
      ['write', ['write_file', 'edit_file']],
      ['edit', ['edit_file', 'search_replace']],
      ['search', ['ripgrep_search', 'codebase_search', 'grep_search']],
      ['find', ['ripgrep_search', 'list_directory', 'glob_search']],
      ['grep', ['ripgrep_search', 'grep_search']],
      ['list', ['list_directory', 'glob_search']],
      ['run', ['bash', 'execute_command']],
      ['execute', ['bash', 'execute_command']],
      ['bash', ['bash']],
      ['terminal', ['bash', 'execute_command']],
      ['command', ['bash', 'execute_command']],
      ['git', ['bash', 'git_status', 'git_diff']],
      ['commit', ['bash', 'git_commit']],
      ['test', ['bash', 'run_tests']],
      ['npm', ['bash']],
      ['install', ['bash']],
      ['build', ['bash']],
      ['create', ['write_file', 'create_directory']],
      ['delete', ['delete_file', 'bash']],
      ['remove', ['delete_file', 'bash']],
      ['copy', ['bash', 'write_file']],
      ['move', ['bash']],
      ['rename', ['bash', 'edit_file']],
      ['web', ['fetch_url', 'web_search']],
      ['fetch', ['fetch_url']],
      ['url', ['fetch_url']],
      ['api', ['fetch_url', 'bash']],
      ['image', ['view_image', 'generate_image']],
      ['screenshot', ['take_screenshot']],
      ['think', ['thinking', 'extended_thinking']],
      ['plan', ['thinking', 'create_plan']],
      ['analyze', ['codebase_search', 'read_file', 'thinking']],
      ['refactor', ['edit_file', 'search_replace']],
      ['debug', ['bash', 'read_file', 'thinking']],
      ['fix', ['edit_file', 'bash']],
      ['error', ['read_file', 'bash', 'thinking']],
      ['todo', ['ripgrep_search', 'edit_file']],
      ['comment', ['edit_file']],
      ['document', ['write_file', 'edit_file']],
      ['readme', ['read_file', 'write_file']],
    ]);
  }

  /**
   * Get tool suggestions based on user input
   */
  suggestTools(input: string): SmartSuggestion[] {
    const suggestions: SmartSuggestion[] = [];
    const inputLower = input.toLowerCase();
    const words = inputLower.split(/\s+/);

    // 1. Keyword-based suggestions
    const keywordSuggestions = this.suggestFromKeywords(words);
    suggestions.push(...keywordSuggestions);

    // 2. Pattern-based suggestions (from learned patterns)
    const patternSuggestions = this.suggestFromPatterns(inputLower);
    suggestions.push(...patternSuggestions);

    // 3. History-based suggestions
    const historySuggestions = this.suggestFromHistory();
    suggestions.push(...historySuggestions);

    // Deduplicate and sort by confidence
    const seen = new Set<string>();
    const uniqueSuggestions = suggestions.filter(s => {
      if (seen.has(s.toolName)) return false;
      seen.add(s.toolName);
      return true;
    });

    return uniqueSuggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  /**
   * Get suggestions from keyword mappings
   */
  private suggestFromKeywords(words: string[]): SmartSuggestion[] {
    const suggestions: SmartSuggestion[] = [];
    const toolScores = new Map<string, number>();

    for (const word of words) {
      // Check direct match
      if (this.keywordToolMap.has(word)) {
        const tools = this.keywordToolMap.get(word)!;
        for (const [i, tool] of tools.entries()) {
          const score = (tools.length - i) / tools.length; // Higher score for earlier tools
          toolScores.set(tool, (toolScores.get(tool) || 0) + score);
        }
      }

      // Check partial matches
      for (const [keyword, tools] of this.keywordToolMap) {
        if (keyword.includes(word) || word.includes(keyword)) {
          for (const tool of tools) {
            toolScores.set(tool, (toolScores.get(tool) || 0) + 0.3);
          }
        }
      }
    }

    // Convert to suggestions
    for (const [tool, score] of toolScores) {
      suggestions.push({
        toolName: tool,
        confidence: Math.min(1, score),
        reason: 'Matches keywords in your input',
        basedOn: 'keyword',
      });
    }

    return suggestions;
  }

  /**
   * Get suggestions from learned patterns
   */
  private suggestFromPatterns(input: string): SmartSuggestion[] {
    const suggestions: SmartSuggestion[] = [];

    for (const [, pattern] of this.patterns) {
      // Check if input matches any keywords in the pattern
      const matchCount = pattern.keywords.filter(kw => input.includes(kw)).length;
      if (matchCount > 0) {
        const matchScore = matchCount / pattern.keywords.length;
        for (const tool of pattern.suggestedTools) {
          suggestions.push({
            toolName: tool,
            confidence: matchScore * pattern.successRate,
            reason: `Learned pattern (${(pattern.successRate * 100).toFixed(0)}% success rate)`,
            basedOn: 'pattern',
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Get suggestions from recent successful tool chains
   */
  private suggestFromHistory(): SmartSuggestion[] {
    const suggestions: SmartSuggestion[] = [];
    const recentSuccess = this.toolChainHistory
      .filter(h => h.success)
      .slice(-20);

    // Count tool frequencies in successful chains
    const toolFreq = new Map<string, number>();
    for (const chain of recentSuccess) {
      for (const tool of chain.tools) {
        toolFreq.set(tool, (toolFreq.get(tool) || 0) + 1);
      }
    }

    // Convert to suggestions
    const maxFreq = Math.max(...Array.from(toolFreq.values()), 1);
    for (const [tool, freq] of toolFreq) {
      suggestions.push({
        toolName: tool,
        confidence: (freq / maxFreq) * 0.5, // Lower confidence for history-based
        reason: `Used in ${freq} recent successful interactions`,
        basedOn: 'history',
      });
    }

    return suggestions;
  }

  /**
   * Learn from a successful tool chain
   */
  learnFromSuccess(input: string, tools: string[]): void {
    if (tools.length === 0) return;

    // Extract keywords from input
    const keywords = input.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2);

    if (keywords.length === 0) return;

    const patternKey = keywords.sort().join('|');
    const existing = this.patterns.get(patternKey);

    if (existing) {
      existing.frequency++;
      existing.successRate = (existing.successRate * (existing.frequency - 1) + 1) / existing.frequency;
      existing.lastUsed = new Date();
      // Merge tools
      for (const tool of tools) {
        if (!existing.suggestedTools.includes(tool)) {
          existing.suggestedTools.push(tool);
        }
      }
    } else {
      this.patterns.set(patternKey, {
        keywords,
        suggestedTools: [...tools],
        frequency: 1,
        successRate: 1,
        lastUsed: new Date(),
      });
    }

    // Record in history
    this.toolChainHistory.push({
      tools,
      success: true,
      timestamp: new Date(),
    });

    // Trim history
    if (this.toolChainHistory.length > this.maxHistory) {
      this.toolChainHistory = this.toolChainHistory.slice(-this.maxHistory);
    }

    this.emit('pattern:learned', { keywords, tools });
  }

  /**
   * Learn from a failed tool chain
   */
  learnFromFailure(input: string, tools: string[]): void {
    const keywords = input.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2);

    if (keywords.length === 0) return;

    const patternKey = keywords.sort().join('|');
    const existing = this.patterns.get(patternKey);

    if (existing) {
      existing.frequency++;
      existing.successRate = (existing.successRate * (existing.frequency - 1)) / existing.frequency;
      existing.lastUsed = new Date();
    }

    // Record in history
    this.toolChainHistory.push({
      tools,
      success: false,
      timestamp: new Date(),
    });

    // Trim history
    if (this.toolChainHistory.length > this.maxHistory) {
      this.toolChainHistory = this.toolChainHistory.slice(-this.maxHistory);
    }
  }

  /**
   * Add a custom keyword -> tool mapping
   */
  addKeywordMapping(keyword: string, tools: string[]): void {
    const existing = this.keywordToolMap.get(keyword) || [];
    const merged = [...new Set([...existing, ...tools])];
    this.keywordToolMap.set(keyword, merged);
  }

  /**
   * Get learned patterns
   */
  getLearnedPatterns(): InputPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Format suggestions for display
   */
  formatSuggestions(suggestions: SmartSuggestion[]): string {
    if (suggestions.length === 0) {
      return 'No tool suggestions available.';
    }

    const lines: string[] = [];
    lines.push('Suggested Tools:');
    lines.push('-'.repeat(40));

    for (const suggestion of suggestions) {
      const confidence = (suggestion.confidence * 100).toFixed(0);
      lines.push(`  ${suggestion.toolName} (${confidence}% confidence)`);
      lines.push(`    ${suggestion.reason}`);
    }

    return lines.join('\n');
  }

  /**
   * Clear learned data
   */
  clear(): void {
    this.patterns.clear();
    this.toolChainHistory = [];
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
}

// Singleton for SmartSuggestionsManager
let suggestionsInstance: SmartSuggestionsManager | null = null;

/**
 * Get global SmartSuggestionsManager instance
 */
export function getSmartSuggestionsManager(): SmartSuggestionsManager {
  if (!suggestionsInstance) {
    suggestionsInstance = new SmartSuggestionsManager();
  }
  return suggestionsInstance;
}

/**
 * Reset global SmartSuggestionsManager
 */
export function resetSmartSuggestionsManager(): void {
  if (suggestionsInstance) {
    suggestionsInstance.dispose();
  }
  suggestionsInstance = null;
}
