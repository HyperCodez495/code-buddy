/**
 * Batch Review Service — consolidate multi-file changes for review.
 *
 * Instead of prompting per-file, collects all pending changes from an agent turn
 * and presents a consolidated diff view with per-file approve/reject + "approve all".
 */

import { logger } from './logger.js';

export interface PendingChange {
  /** File path */
  filePath: string;
  /** Type of change */
  type: 'create' | 'edit' | 'delete';
  /** Diff or content preview (truncated) */
  diff: string;
  /** Tool name that produced this change */
  tool: string;
  /** Tool call ID for tracking */
  callId: string;
  /** Whether this change has been approved */
  approved: boolean;
  /** Whether this change has been rejected */
  rejected: boolean;
}

export interface BatchReviewResult {
  /** Changes that were approved */
  approved: PendingChange[];
  /** Changes that were rejected */
  rejected: PendingChange[];
  /** Whether "approve all" was used */
  bulkApproved: boolean;
}

export class BatchReviewService {
  private pendingChanges: PendingChange[] = [];
  private batchMode = false;
  private turnId = 0;

  /**
   * Start collecting changes for batch review.
   * Call at the beginning of an agent turn.
   */
  startBatch(): void {
    this.pendingChanges = [];
    this.batchMode = true;
    this.turnId++;
    logger.debug(`BatchReview: started batch ${this.turnId}`);
  }

  /**
   * Add a pending change to the current batch.
   * Returns false if not in batch mode (caller should use normal confirmation).
   */
  addChange(change: Omit<PendingChange, 'approved' | 'rejected'>): boolean {
    if (!this.batchMode) return false;

    this.pendingChanges.push({
      ...change,
      approved: false,
      rejected: false,
    });

    logger.debug(`BatchReview: queued ${change.type} for ${change.filePath}`);
    return true;
  }

  /**
   * Get all pending changes for review.
   */
  getPendingChanges(): PendingChange[] {
    return [...this.pendingChanges];
  }

  /**
   * Get a formatted summary of all pending changes.
   */
  formatBatchSummary(): string {
    if (this.pendingChanges.length === 0) {
      return 'No pending changes to review.';
    }

    const lines: string[] = [
      `\n── Batch Review (${this.pendingChanges.length} file${this.pendingChanges.length > 1 ? 's' : ''}) ──`,
      '',
    ];

    for (let i = 0; i < this.pendingChanges.length; i++) {
      const change = this.pendingChanges[i];
      if (!change) continue;
      const icon = change.type === 'create' ? '+' : change.type === 'delete' ? '-' : '~';
      const status = change.approved ? ' [approved]' : change.rejected ? ' [rejected]' : '';
      lines.push(`  [${i + 1}] ${icon} ${change.filePath} (${change.type})${status}`);

      // Show truncated diff preview
      if (change.diff) {
        const diffLines = change.diff.split('\n');
        const preview = diffLines.slice(0, 5).map(l => `      ${l}`).join('\n');
        lines.push(preview);
        if (diffLines.length > 5) {
          lines.push(`      ... (${diffLines.length - 5} more lines)`);
        }
      }
      lines.push('');
    }

    lines.push('Actions: [a]pprove all | [r]eject all | [1-N] toggle | [d]one');
    return lines.join('\n');
  }

  /**
   * Approve all pending changes.
   */
  approveAll(): BatchReviewResult {
    for (const change of this.pendingChanges) {
      change.approved = true;
      change.rejected = false;
    }
    return this.finalize(true);
  }

  /**
   * Reject all pending changes.
   */
  rejectAll(): BatchReviewResult {
    for (const change of this.pendingChanges) {
      change.approved = false;
      change.rejected = true;
    }
    return this.finalize(false);
  }

  /**
   * Approve a specific change by index (0-based).
   */
  approveChange(index: number): boolean {
    if (index < 0 || index >= this.pendingChanges.length) return false;
    const change = this.pendingChanges[index];
    if (!change) return false;
    change.approved = true;
    change.rejected = false;
    return true;
  }

  /**
   * Reject a specific change by index (0-based).
   */
  rejectChange(index: number): boolean {
    if (index < 0 || index >= this.pendingChanges.length) return false;
    const change = this.pendingChanges[index];
    if (!change) return false;
    change.approved = false;
    change.rejected = true;
    return true;
  }

  /**
   * Toggle a change's approval status by index (0-based).
   */
  toggleChange(index: number): boolean {
    if (index < 0 || index >= this.pendingChanges.length) return false;
    const change = this.pendingChanges[index];
    if (!change) return false;
    if (change.approved) {
      change.approved = false;
      change.rejected = true;
    } else {
      change.approved = true;
      change.rejected = false;
    }
    return true;
  }

  /**
   * Finalize the batch review and return results.
   */
  finalize(bulkApproved = false): BatchReviewResult {
    const result: BatchReviewResult = {
      approved: this.pendingChanges.filter(c => c.approved),
      rejected: this.pendingChanges.filter(c => c.rejected || !c.approved),
      bulkApproved,
    };

    this.batchMode = false;
    logger.debug(`BatchReview: finalized batch ${this.turnId} — ${result.approved.length} approved, ${result.rejected.length} rejected`);
    return result;
  }

  /**
   * Check if batch mode is active.
   */
  isBatchMode(): boolean {
    return this.batchMode;
  }

  /**
   * Check if there are pending changes to review.
   */
  hasPendingChanges(): boolean {
    return this.batchMode && this.pendingChanges.length > 0;
  }

  /**
   * Get the count of pending changes.
   */
  getPendingCount(): number {
    return this.pendingChanges.length;
  }

  /**
   * Cancel batch mode without applying any changes.
   */
  cancelBatch(): void {
    this.batchMode = false;
    this.pendingChanges = [];
    logger.debug(`BatchReview: cancelled batch ${this.turnId}`);
  }
}

/** Singleton */
let _instance: BatchReviewService | null = null;

export function getBatchReviewService(): BatchReviewService {
  if (!_instance) {
    _instance = new BatchReviewService();
  }
  return _instance;
}

export function resetBatchReviewService(): void {
  _instance = null;
}
