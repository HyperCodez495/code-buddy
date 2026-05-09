/**
 * @phuetz/ai-providers — Circuit Breaker
 *
 * Fail-fast pattern for LLM provider health management.
 * Prevents cascading failures by cutting off unhealthy providers.
 */

// ============================================================================
// Types
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5). */
  failureThreshold: number;
  /** Time in ms before attempting recovery (default: 60000). */
  resetTimeout: number;
  /** Successes needed in half-open to close circuit (default: 2). */
  successThreshold: number;
  /** Sliding window in ms for counting failures (default: 60000). */
  failureWindow: number;
  /** Callback on state transitions. */
  onStateChange?: (from: CircuitState, to: CircuitState, breaker: CircuitBreaker) => void;
  /** Callback when a request is rejected (circuit open). */
  onReject?: (breaker: CircuitBreaker) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number | null;
  nextAttemptAt: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejected: number;
}

// ============================================================================
// Error
// ============================================================================

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
    public readonly nextAttemptAt: number | null,
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60_000,
  successThreshold: 2,
  failureWindow: 60_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureTimestamps: number[] = [];
  private halfOpenSuccesses = 0;
  private openedAt: number | null = null;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRejected = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(
    public readonly name: string,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitBreakerError if circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (!this.canExecute()) {
      this.totalRejected++;
      this.config.onReject?.(this);
      throw new CircuitBreakerError(
        `Circuit breaker '${this.name}' is open`,
        this.state,
        this.getNextAttemptAt(),
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Check if execution is allowed. */
  canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return this.shouldAttemptReset();
      case 'half-open':
        return true;
      default:
        return false;
    }
  }

  /** Get current stats. */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.getRecentFailures(),
      successes: this.halfOpenSuccesses,
      openedAt: this.openedAt,
      nextAttemptAt: this.getNextAttemptAt(),
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalRejected: this.totalRejected,
    };
  }

  /** Get current state. */
  getState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state === 'open' && this.shouldAttemptReset()) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /** Manually reset the circuit to closed. */
  reset(): void {
    this.transitionTo('closed');
    this.failureTimestamps = [];
    this.halfOpenSuccesses = 0;
    this.openedAt = null;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private onSuccess(): void {
    this.totalSuccesses++;

    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
        this.failureTimestamps = [];
        this.halfOpenSuccesses = 0;
        this.openedAt = null;
      }
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failureTimestamps.push(Date.now());

    if (this.state === 'half-open') {
      // Any failure in half-open re-opens the circuit
      this.transitionTo('open');
      this.halfOpenSuccesses = 0;
      return;
    }

    if (this.state === 'closed') {
      const recentFailures = this.getRecentFailures();
      if (recentFailures >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  private getRecentFailures(): number {
    const cutoff = Date.now() - this.config.failureWindow;
    this.failureTimestamps = this.failureTimestamps.filter(t => t > cutoff);
    return this.failureTimestamps.length;
  }

  private shouldAttemptReset(): boolean {
    if (this.openedAt === null) return false;
    return Date.now() - this.openedAt >= this.config.resetTimeout;
  }

  private getNextAttemptAt(): number | null {
    if (this.state !== 'open' || this.openedAt === null) return null;
    return this.openedAt + this.config.resetTimeout;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    if (newState === 'open') {
      this.openedAt = Date.now();
    }

    this.config.onStateChange?.(oldState, newState, this);
  }
}

// ============================================================================
// Registry
// ============================================================================

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a named circuit breaker.
 *
 * @example
 * ```ts
 * const breaker = getCircuitBreaker('gemini', { failureThreshold: 3 });
 * const result = await breaker.execute(() => callGeminiApi());
 * ```
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    breakers.set(name, breaker);
  }
  return breaker;
}

/** Reset all circuit breakers. */
export function resetAllCircuitBreakers(): void {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
  breakers.clear();
}
