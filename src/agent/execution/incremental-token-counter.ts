import type { CodeBuddyMessage } from '../../codebuddy/client.js';

/**
 * Counts only messages appended since the previous observation. Call
 * `invalidate()` after compaction or any in-place content rewrite.
 */
export class IncrementalMessageTokenCounter {
  private messageCount = 0;
  private total = 0;
  private invalidated = true;
  private references: CodeBuddyMessage[] = [];

  constructor(
    private readonly countBatch: (messages: CodeBuddyMessage[]) => number,
  ) {}

  count(messages: CodeBuddyMessage[]): number {
    const prefixChanged =
      messages.length < this.messageCount ||
      this.references.some((message, index) => messages[index] !== message);
    if (this.invalidated || prefixChanged) {
      this.total = this.countBatch(messages);
      this.messageCount = messages.length;
      this.references = [...messages];
      this.invalidated = false;
      return this.total;
    }

    if (messages.length > this.messageCount) {
      const delta = messages.slice(this.messageCount);
      this.total += this.countBatch(delta);
      this.messageCount = messages.length;
      this.references.push(...delta);
    }
    return this.total;
  }

  invalidate(): void {
    this.invalidated = true;
  }
}
