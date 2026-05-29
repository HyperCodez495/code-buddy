/**
 * Loop Detection Service — 3-Tier
 *
 * Detects when the agent is stuck in unproductive loops:
 *
 * Tier 1: Tool Call Repetition — same tool+args 5 times consecutively
 * Tier 2: Content Chanting — repeated 50-char chunks in output
 * Tier 3: LLM-Based Diagnosis — asks a separate model after N turns
 *
 * Inspired by Gemini CLI's loopDetectionService.ts
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

// ============================================================================
// Configuration
// ============================================================================

/** Tier 1: consecutive identical tool calls to trigger */
const TOOL_CALL_LOOP_THRESHOLD = 5;

/** Tier 2: chunk size for content chanting detection */
const CONTENT_CHUNK_SIZE = 50;

/** Tier 2: number of repeated chunks to trigger */
const CONTENT_LOOP_THRESHOLD = 10;

/** Tier 2: maximum content history to track */
const MAX_CONTENT_HISTORY = 5000;

/** Tier 3: first LLM check after this many turns */
const LLM_CHECK_AFTER_TURNS = 30;

/** Tier 3: check every N turns after first check */
const LLM_CHECK_INTERVAL = 10;

// ============================================================================
// Types
// ============================================================================

export interface LoopDetectionResult {
  /** Whether a loop was detected */
  loopDetected: boolean;
  /** Which tier detected the loop (0 = none) */
  tier: 0 | 1 | 2 | 3;
  /** Human-readable description */
  message: string;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface ToolCallInfo {
  name: string;
  args: string;
}

// ============================================================================
// Loop Detection Service
// ============================================================================

export class LoopDetectionService {
  // Tier 1: tool call tracking
  private lastToolHash = '';
  private consecutiveCount = 0;

  // Tier 2: content chanting
  private contentHistory = '';
  private chunkHashes = new Map<string, number[]>(); // hash → positions

  // Tier 3: LLM diagnosis
  private turnCount = 0;
  private lastLLMCheckTurn = 0;

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.lastToolHash = '';
    this.consecutiveCount = 0;
    this.contentHistory = '';
    this.chunkHashes.clear();
    this.turnCount = 0;
    this.lastLLMCheckTurn = 0;
  }

  /**
   * Record a tool call for Tier 1 detection.
   */
  recordToolCall(info: ToolCallInfo): LoopDetectionResult {
    const hash = createHash('sha256')
      .update(`${info.name}:${info.args}`)
      .digest('hex');

    if (hash === this.lastToolHash) {
      this.consecutiveCount++;
    } else {
      this.lastToolHash = hash;
      this.consecutiveCount = 1;
    }

    if (this.consecutiveCount >= TOOL_CALL_LOOP_THRESHOLD) {
      return {
        loopDetected: true,
        tier: 1,
        message: `Tool call loop detected: "${info.name}" called ${this.consecutiveCount} times consecutively with identical arguments.`,
        confidence: 0.95,
      };
    }

    return { loopDetected: false, tier: 0, message: '', confidence: 0 };
  }

  /**
   * Record content output for Tier 2 detection (content chanting).
   */
  recordContent(content: string): LoopDetectionResult {
    // Skip code blocks (common false positive source)
    const cleaned = content.replace(/```[\s\S]*?```/g, '');
    if (cleaned.length < CONTENT_CHUNK_SIZE) {
      return { loopDetected: false, tier: 0, message: '', confidence: 0 };
    }

    // Append to history, trim if needed
    this.contentHistory += cleaned;
    if (this.contentHistory.length > MAX_CONTENT_HISTORY) {
      const trim = this.contentHistory.length - MAX_CONTENT_HISTORY;
      this.contentHistory = this.contentHistory.slice(trim);
      // Adjust positions in hash map
      for (const [hash, positions] of this.chunkHashes) {
        const adjusted = positions.map(p => p - trim).filter(p => p >= 0);
        if (adjusted.length === 0) {
          this.chunkHashes.delete(hash);
        } else {
          this.chunkHashes.set(hash, adjusted);
        }
      }
    }

    // Slide 50-char window and hash chunks
    const startPos = Math.max(0, this.contentHistory.length - cleaned.length);
    for (let i = startPos; i <= this.contentHistory.length - CONTENT_CHUNK_SIZE; i += CONTENT_CHUNK_SIZE) {
      const chunk = this.contentHistory.substring(i, i + CONTENT_CHUNK_SIZE);
      const hash = createHash('sha256').update(chunk).digest('hex').substring(0, 16);

      const positions = this.chunkHashes.get(hash) ?? [];
      positions.push(i);
      this.chunkHashes.set(hash, positions);

      // Check for chanting: same chunk appearing CONTENT_LOOP_THRESHOLD times
      if (positions.length >= CONTENT_LOOP_THRESHOLD) {
        // Verify they're close together (not just coincidental matches)
        const recent = positions.slice(-CONTENT_LOOP_THRESHOLD);
        const first = recent[0];
        const last = recent[recent.length - 1];
        if (first === undefined || last === undefined || recent.length < 2) continue;
        const avgDist = (last - first) / (recent.length - 1);

        if (avgDist <= CONTENT_CHUNK_SIZE * 5) {
          return {
            loopDetected: true,
            tier: 2,
            message: `Content chanting detected: same ${CONTENT_CHUNK_SIZE}-char pattern repeated ${positions.length} times.`,
            confidence: 0.85,
          };
        }
      }
    }

    return { loopDetected: false, tier: 0, message: '', confidence: 0 };
  }

  /**
   * Check if LLM-based loop diagnosis should run (Tier 3).
   * Returns true if enough turns have passed since last check.
   */
  shouldRunLLMCheck(): boolean {
    this.turnCount++;

    if (this.turnCount < LLM_CHECK_AFTER_TURNS) return false;
    if (this.turnCount - this.lastLLMCheckTurn < LLM_CHECK_INTERVAL) return false;

    return true;
  }

  /**
   * Mark that an LLM check was performed.
   */
  markLLMCheckDone(): void {
    this.lastLLMCheckTurn = this.turnCount;
  }

  /**
   * Get the system prompt for LLM-based loop diagnosis.
   */
  getLLMDiagnosticPrompt(): string {
    return `You are analyzing whether an AI coding agent is stuck in an unproductive loop.

Analyze the recent conversation history and determine if the agent is:
1. Making genuine progress toward the user's goal
2. Repeating similar actions with no meaningful results
3. Stuck in an error-retry cycle that isn't converging

IMPORTANT: Distinguish between:
- Productive batch operations (editing multiple files with different content) = NOT a loop
- Retrying the same operation with slightly different parameters = POTENTIAL loop
- Repeating the exact same tool call or response = DEFINITE loop

Respond with JSON:
{
  "is_stuck": boolean,
  "confidence": number (0-1),
  "reason": "brief explanation"
}`;
  }

  /**
   * Parse the LLM diagnostic response.
   */
  parseLLMDiagnostic(response: string): LoopDetectionResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return { loopDetected: false, tier: 0, message: '', confidence: 0 };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const isStuck = parsed.is_stuck === true;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      if (isStuck && confidence >= 0.9) {
        return {
          loopDetected: true,
          tier: 3,
          message: `LLM diagnosis: agent appears stuck. ${parsed.reason || ''}`,
          confidence,
        };
      }

      return { loopDetected: false, tier: 0, message: '', confidence };
    } catch {
      logger.debug('Failed to parse LLM loop diagnostic response');
      return { loopDetected: false, tier: 0, message: '', confidence: 0 };
    }
  }
}

/** Singleton instance */
let _instance: LoopDetectionService | null = null;

export function getLoopDetectionService(): LoopDetectionService {
  if (!_instance) {
    _instance = new LoopDetectionService();
  }
  return _instance;
}

export function resetLoopDetectionService(): void {
  _instance?.reset();
  _instance = null;
}
