export interface FleetLoad {
  queued: number;
  running: number;
  capacity: number;
  backpressure: number;
  utilization: number;
}

export function saturationLevel(load: FleetLoad): 'idle' | 'nominal' | 'saturated' {
  if (load.running === 0 && load.queued === 0 && load.utilization < 0.2) {
    return 'idle';
  }
  if (load.utilization >= 0.85 || load.backpressure >= 0.7 || load.queued > load.capacity) {
    return 'saturated';
  }
  return 'nominal';
}

export function formatUtilization(value: number): string {
  return String(Math.round(Math.max(0, Math.min(1, value)) * 100)) + '%';
}
