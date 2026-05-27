import path from 'node:path';
import { z } from 'zod';

const CONTRACT_VERSION = 1 as const;
const trimmed = z.string().trim().min(1);

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const riskLevelSchema = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting_approval',
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const CAPABILITY_LEVELS = ['read', 'reversible-write', 'sensitive'] as const;
export const capabilityLevelSchema = z.enum(CAPABILITY_LEVELS);
export type CapabilityLevel = z.infer<typeof capabilityLevelSchema>;

export const CAPABILITY_POLICIES = ['autonomous', 'dry-run-required', 'approval-required'] as const;
export const capabilityPolicySchema = z.enum(CAPABILITY_POLICIES);
export type CapabilityPolicy = z.infer<typeof capabilityPolicySchema>;

export const MEMORY_POLICIES = ['none', 'handoff', 'lessons'] as const;
export const memoryPolicySchema = z.enum(MEMORY_POLICIES);
export type MemoryPolicy = z.infer<typeof memoryPolicySchema>;

export const FLEET_POLICIES = ['none', 'read-only-help', 'delegated-slices'] as const;
export const fleetPolicySchema = z.enum(FLEET_POLICIES);
export type FleetPolicy = z.infer<typeof fleetPolicySchema>;

export const WORKFLOW_CANVAS_KINDS = ['trigger', 'action', 'logic'] as const;
export const workflowCanvasKindSchema = z.enum(WORKFLOW_CANVAS_KINDS);
export type WorkflowCanvasKind = z.infer<typeof workflowCanvasKindSchema>;

export const WORKFLOW_NODE_ROLES = [
  'gate',
  'analysis',
  'approval',
  'edit',
  'verification',
  'handoff',
] as const;
export const workflowNodeRoleSchema = z.enum(WORKFLOW_NODE_ROLES);
export type WorkflowNodeRole = z.infer<typeof workflowNodeRoleSchema>;

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const RUN_EVENT_TYPES = [
  'run_start',
  'run_end',
  'step_start',
  'step_end',
  'tool_call',
  'tool_result',
  'patch_created',
  'patch_applied',
  'decision',
  'error',
  'metric',
  'lesson_added',
  'lesson_candidate_proposed',
] as const;
export const runEventTypeSchema = z.enum(RUN_EVENT_TYPES);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const actorSchema = z.object({
  type: z.enum(['agent', 'human']),
  id: trimmed.max(120),
  provider: trimmed.max(80).optional(),
}).strict();
export type Actor = z.infer<typeof actorSchema>;

function normalizeScopePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isBoundedRelativePath(value: string): boolean {
  if (!value || value === '.' || value === '*' || value === '**' || value === '**/*') {
    return false;
  }
  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return !value.split('/').includes('..');
}

export const scopePathSchema = trimmed
  .max(240)
  .transform(normalizeScopePath)
  .refine(isBoundedRelativePath, {
    message: 'scope paths must be bounded relative paths without traversal',
  });

export const runMetricsSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  failoverCount: z.number().int().nonnegative(),
}).partial();
export type RunMetrics = z.infer<typeof runMetricsSchema>;

export const runSchema = z.object({
  kind: z.literal('run'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  actor: actorSchema,
  parentRunId: trimmed.max(120).optional(),
  objective: trimmed.max(2000),
  status: runStatusSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  metrics: runMetricsSchema.optional(),
  metadata: z.object({
    channel: trimmed.max(80).optional(),
    userId: trimmed.max(120).optional(),
    sessionId: trimmed.max(120).optional(),
    organ: trimmed.max(80).optional(),
    tags: z.array(trimmed.max(80)).max(30).default([]),
  }).strict().optional(),
}).strict();
export type Run = z.infer<typeof runSchema>;

export const runEventSchema = z.object({
  ts: z.number().int().nonnegative(),
  type: runEventTypeSchema,
  runId: trimmed.max(120),
  data: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type RunEvent = z.infer<typeof runEventSchema>;

export const PROOF_TYPES = ['log', 'artifact', 'platform-post', 'patch', 'metric'] as const;
export const proofTypeSchema = z.enum(PROOF_TYPES);
export type ProofType = z.infer<typeof proofTypeSchema>;

export const proofSchema = z.object({
  kind: z.literal('proof'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  runId: trimmed.max(120),
  type: proofTypeSchema,
  createdAt: z.number().int().nonnegative(),
  producedBy: actorSchema,
  summary: trimmed.max(2000),
  ref: trimmed.max(1000).optional(),
}).strict();
export type Proof = z.infer<typeof proofSchema>;

export const sensitiveActionSchema = z.object({
  kind: z.literal('sensitive-action'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  name: trimmed.max(120),
  riskLevel: riskLevelSchema,
  scope: z.array(scopePathSchema).max(50).default([]),
  defaultDryRun: z.boolean().default(true),
  requires: capabilityPolicySchema,
}).strict();
export type SensitiveAction = z.infer<typeof sensitiveActionSchema>;

const workflowNodeIdSchema = trimmed
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/, 'node ids may only contain letters, numbers, . _ : -');

export const workflowNodeSchema = z.object({
  id: workflowNodeIdSchema,
  label: trimmed.max(120),
  canvasKind: workflowCanvasKindSchema,
  role: workflowNodeRoleSchema.optional(),
}).strict();
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  source: workflowNodeIdSchema,
  target: workflowNodeIdSchema,
}).strict();
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowSchema = z.object({
  kind: z.literal('workflow'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  version: z.number().int().positive(),
  summary: trimmed.max(1000),
  nodes: z.array(workflowNodeSchema).min(1).max(200),
  edges: z.array(workflowEdgeSchema).max(400).default([]),
  approvalGates: z.array(trimmed.max(500)).default([]),
}).strict();
export type Workflow = z.infer<typeof workflowSchema>;

export const approvalSchema = z.object({
  kind: z.literal('approval'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  target: trimmed.max(200),
  runId: trimmed.max(120).optional(),
  decision: approvalDecisionSchema,
  reviewer: trimmed.max(120),
  reason: trimmed.max(1000),
  decidedAt: z.number().int().nonnegative(),
  scope: trimmed.max(240).optional(),
  expiresAt: z.number().int().nonnegative().optional(),
}).strict();
export type Approval = z.infer<typeof approvalSchema>;

export const LESSON_TIERS = ['technical', 'experience'] as const;
export const lessonTierSchema = z.enum(LESSON_TIERS);
export type LessonTier = z.infer<typeof lessonTierSchema>;

export const lessonSchema = z.object({
  kind: z.literal('lesson'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  tier: lessonTierSchema,
  content: trimmed.max(5000),
  sourceRunId: trimmed.max(120),
  createdAt: z.number().int().nonnegative(),
  tags: z.array(trimmed.max(80)).max(30).default([]),
  policy: memoryPolicySchema.default('lessons'),
}).strict();
export type Lesson = z.infer<typeof lessonSchema>;

export const capabilitySchema = z.object({
  kind: z.literal('capability'),
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: trimmed.max(120),
  name: trimmed.max(120),
  level: capabilityLevelSchema,
  policy: capabilityPolicySchema,
  fleetPolicy: fleetPolicySchema.default('none'),
  description: trimmed.max(1000).optional(),
}).strict();
export type Capability = z.infer<typeof capabilitySchema>;

export const harnessArtifactSchema = z.discriminatedUnion('kind', [
  runSchema,
  proofSchema,
  sensitiveActionSchema,
  workflowSchema,
  approvalSchema,
  lessonSchema,
  capabilitySchema,
]);
export type HarnessArtifact = z.infer<typeof harnessArtifactSchema>;

export const HARNESS_CONTRACT_VERSION = CONTRACT_VERSION;
