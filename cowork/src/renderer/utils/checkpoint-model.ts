/**
 * Pure checkpoint helpers for mission resume and branch surfaces.
 *
 * @module renderer/utils/checkpoint-model
 */

export type CheckpointStatus = 'stable' | 'draft' | 'failed';

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: number;
  status: CheckpointStatus;
  summary?: string;
}

export function pickLatestStable(checkpoints: Checkpoint[]): Checkpoint | null {
  let latest: Checkpoint | null = null;

  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== 'stable') continue;
    if (!latest || checkpoint.createdAt > latest.createdAt) {
      latest = checkpoint;
    }
  }

  return latest;
}
