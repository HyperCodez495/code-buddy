/**
 * Pure risk helpers for remote human-in-the-loop approvals.
 *
 * @module renderer/utils/approval-model
 */

export interface ApprovalRequest {
  id: string;
  action: string;
  diffSummary: string;
  riskFactors: string[];
  destructive?: boolean;
  costUsd?: number;
}

export function riskLevel(request: ApprovalRequest): 'low' | 'medium' | 'high' {
  if (request.destructive) return 'high';
  if ((request.costUsd ?? 0) >= 5) return 'high';
  if (request.riskFactors.length >= 3) return 'high';
  if ((request.costUsd ?? 0) >= 1) return 'medium';
  if (request.riskFactors.length > 0) return 'medium';
  return 'low';
}
