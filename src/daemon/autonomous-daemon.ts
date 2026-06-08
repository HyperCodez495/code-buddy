/**
 * Fleet autonomous daemon — runs {@link FleetAutonomousLoop} continuously.
 *
 * This is the "always-on, like a smart speaker" layer: it ticks the loop on an
 * interval (claiming + executing fleet tasks on the free-first model ladder)
 * until stopped. Idle ticks keep presence fresh; a kill-switch and a `maxTicks`
 * bound make it safe to run finite or supervised.
 *
 * The loop itself never throws and the v0 executor only writes scoped artifacts,
 * so continuous unattended operation has no repo blast radius. The full agentic
 * executor (tools/edits) remains a separate, checkpointed step.
 */

import { FleetColabStore } from '../fleet/colab-store.js';
import { resolveModelTierConfig, type ModelTierPolicy } from '../agent/model-tier.js';
import { FleetAutonomousLoop, type TickResult } from './autonomous-loop.js';
import { createLocalModelTaskExecutor } from './ollama-task-executor.js';

export interface AutonomousDaemonConfig {
  loop: FleetAutonomousLoop;
  /** Delay between ticks (default 30s). */
  intervalMs?: number;
  /** Called after each tick with the result and 1-based tick number. */
  onTick?: (result: TickResult, tickNumber: number) => void;
  /** Extra kill-switch checked each iteration (in addition to the loop's). */
  enabled?: () => boolean;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface DaemonRunSummary {
  ticks: number;
  outcomes: Record<string, number>;
  stoppedReason: 'maxTicks' | 'stopped' | 'disabled';
}

const DEFAULT_INTERVAL_MS = 30_000;

export class FleetAutonomousDaemon {
  private readonly loop: FleetAutonomousLoop;
  private readonly intervalMs: number;
  private readonly onTick?: (result: TickResult, tickNumber: number) => void;
  private readonly enabled: () => boolean;
  private readonly sleepFn?: (ms: number) => Promise<void>;
  private running = false;
  private resolveWait?: () => void;

  constructor(config: AutonomousDaemonConfig) {
    this.loop = config.loop;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (config.onTick) this.onTick = config.onTick;
    this.enabled = config.enabled ?? (() => true);
    if (config.sleep) this.sleepFn = config.sleep;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Stop after the current tick (also cuts any pending wait short). */
  stop(): void {
    this.running = false;
    this.resolveWait?.();
  }

  /**
   * Event-driven trigger: cut the current inter-tick wait short so the loop ticks
   * immediately. This turns the interval poller into a message-queue-style worker
   * — a new task / fleet event calls `wake()` and work starts now instead of at
   * the next interval. The interval remains as a safety heartbeat.
   */
  wake(): void {
    this.resolveWait?.();
  }

  private waitBetweenTicks(): Promise<void> {
    if (this.sleepFn) return this.sleepFn(this.intervalMs);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveWait = undefined;
        resolve();
      }, this.intervalMs);
      this.resolveWait = () => {
        clearTimeout(timer);
        this.resolveWait = undefined;
        resolve();
      };
    });
  }

  /**
   * Run the loop continuously. Pass `maxTicks` for a bounded run (finite
   * sessions, tests); omit it for an always-on daemon (stop via {@link stop}).
   */
  async run(opts: { maxTicks?: number } = {}): Promise<DaemonRunSummary> {
    const max = opts.maxTicks ?? Number.POSITIVE_INFINITY;
    const outcomes: Record<string, number> = {};
    let ticks = 0;
    let stoppedReason: DaemonRunSummary['stoppedReason'] = 'maxTicks';
    this.running = true;

    while (this.running && ticks < max) {
      if (!this.enabled()) {
        stoppedReason = 'disabled';
        break;
      }
      const result = await this.loop.tick();
      ticks += 1;
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      this.onTick?.(result, ticks);

      if (!this.running) {
        stoppedReason = 'stopped';
        break;
      }
      if (ticks < max) {
        await this.waitBetweenTicks();
      }
    }

    this.running = false;
    return { ticks, outcomes, stoppedReason };
  }
}

export interface DefaultAutonomousLoopOptions {
  /** Colab dir override (default: CODEBUDDY_FLEET_COLAB_DIR or <cwd>/.codebuddy). */
  dir?: string;
  agentId?: string;
  outputDir?: string;
  policy?: ModelTierPolicy;
  enabled?: () => boolean;
}

/**
 * Wire a production loop: env-resolved model ladder + colab store + the real
 * local/network executor. The CLI uses this so the same config drives one-shot
 * and continuous runs.
 */
export function createDefaultAutonomousLoop(opts: DefaultAutonomousLoopOptions = {}): FleetAutonomousLoop {
  const store = new FleetColabStore({
    ...(opts.dir ? { dir: opts.dir } : {}),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  });
  const tierConfig = resolveModelTierConfig();
  const executor = createLocalModelTaskExecutor({
    ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
    ...(process.env['CODEBUDDY_ESCALATION_API_KEY'] ? { apiKey: process.env['CODEBUDDY_ESCALATION_API_KEY'] } : {}),
  });
  return new FleetAutonomousLoop({
    store,
    tierConfig,
    executor,
    ...(opts.policy ? { policy: opts.policy } : {}),
    ...(opts.enabled ? { enabled: opts.enabled } : {}),
  });
}
