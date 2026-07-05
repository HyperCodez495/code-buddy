export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
  id: string;
  action: string;
  riskScore: number;
  summary: string;
}

export function riskLevel(score: number): ApprovalRisk {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function partitionByRisk(requests: ApprovalRequest[]): Record<ApprovalRisk, ApprovalRequest[]> {
  return requests.reduce<Record<ApprovalRisk, ApprovalRequest[]>>(
    (groups, request) => {
      groups[riskLevel(request.riskScore)].push(request);
      return groups;
    },
    { low: [], medium: [], high: [], critical: [] },
  );
}
