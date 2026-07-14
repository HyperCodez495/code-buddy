import { z } from 'zod';

export const COGNITIVE_WIRE_VERSION = 1 as const;

export const WORKSPACE_KINDS = [
  'percept',
  'utterance',
  'fact',
  'hypothesis',
  'goal',
  'plan',
  'proposal',
  'alert',
  'action',
  'result',
] as const;

export const WORKSPACE_PRIVACY = ['cloud-ok', 'trusted-lan', 'local-only'] as const;

const safeText = (max: number) =>
  z.string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'text cannot be blank')
    .refine((value) => !value.includes('\0'), 'NUL bytes are forbidden');

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]*$/);
const itemId = z.string().min(1).max(160).regex(/^workspace_[a-zA-Z0-9_.:-]+$/);
const commonDraftShape = {
  correlationId: identifier,
  salience: z.number().finite().min(0).max(1),
  confidence: z.number().finite().min(0).max(1),
  privacy: z.enum(WORKSPACE_PRIVACY),
  ttlMs: z.number().int().min(100).max(86_400_000).optional(),
  dedupeKey: identifier.optional(),
  parentItemIds: z.array(itemId).max(16).optional(),
};

export const cognitiveUtterancePayloadSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: safeText(8_000),
  surface: identifier.max(64),
}).strict();

export const cognitiveSummaryPayloadSchema = z.object({
  summary: safeText(1_000),
  tags: z.array(identifier.max(64)).max(16).optional(),
}).strict();

const normalizedBox2dSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().refine(
  (box) => box.x + box.width <= 1 && box.y + box.height <= 1,
  'box2d must fit inside normalized image coordinates',
);

export const cognitivePerceptPayloadSchema = z.object({
  modality: identifier.max(64),
  kind: identifier.max(64),
  observedAt: z.number().int().nonnegative(),
  sensorId: identifier.max(64),
  confidence: z.number().finite().min(0).max(1),
  /** Untrusted detector episode. The hub replaces it with a scoped hash. */
  presenceEpisodeId: identifier.optional(),
  occupancyCount: z.number().int().min(0).max(8).optional(),
  departureConfirmed: z.literal(true).optional(),
  box2d: normalizedBox2dSchema.optional(),
}).strict().superRefine((payload, context) => {
  const hasEmbodiedDetail = payload.presenceEpisodeId !== undefined ||
    payload.occupancyCount !== undefined ||
    payload.departureConfirmed !== undefined ||
    payload.box2d !== undefined;
  if (hasEmbodiedDetail && payload.modality !== 'vision') {
    context.addIssue({
      code: 'custom',
      message: 'embodied tracking fields require vision modality',
      path: ['modality'],
    });
  }
  if (payload.box2d && !payload.presenceEpisodeId) {
    context.addIssue({
      code: 'custom',
      message: 'box2d requires an anonymous presence episode',
      path: ['box2d'],
    });
  }
  if (
    payload.occupancyCount === 0 &&
    (payload.kind === 'person_entered' || payload.kind === 'person_observed')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'a visible person percept cannot report zero visible detections',
      path: ['occupancyCount'],
    });
  }
  if (payload.occupancyCount !== undefined && payload.occupancyCount > 0 && payload.confidence === 0) {
    context.addIssue({
      code: 'custom',
      message: 'positive visible detections require non-zero confidence',
      path: ['confidence'],
    });
  }
  if (payload.departureConfirmed && payload.kind !== 'person_left') {
    context.addIssue({
      code: 'custom',
      message: 'departureConfirmed is valid only for person_left',
      path: ['departureConfirmed'],
    });
  }
});

const summaryDraft = <T extends 'fact' | 'hypothesis' | 'goal' | 'plan' | 'proposal' | 'alert'>(
  kind: T,
) => z.object({
  ...commonDraftShape,
  kind: z.literal(kind),
  payload: cognitiveSummaryPayloadSchema,
}).strict();

/**
 * Network-safe drafts. `action` is intentionally absent: remote clients may
 * describe a proposal, but cannot inject executable intent into the workspace.
 */
export const cognitiveDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    ...commonDraftShape,
    kind: z.literal('percept'),
    payload: cognitivePerceptPayloadSchema,
  }).strict(),
  z.object({
    ...commonDraftShape,
    kind: z.literal('utterance'),
    payload: cognitiveUtterancePayloadSchema,
  }).strict(),
  summaryDraft('fact'),
  summaryDraft('hypothesis'),
  summaryDraft('goal'),
  summaryDraft('plan'),
  summaryDraft('proposal'),
  summaryDraft('alert'),
  z.object({
    ...commonDraftShape,
    kind: z.literal('result'),
    payload: cognitiveUtterancePayloadSchema,
  }).strict(),
]);

export const cognitivePublishRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  clientEventId: z.string().uuid(),
  draft: cognitiveDraftSchema,
}).strict();

export const cognitiveCancelRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  correlationId: identifier,
}).strict();

export const cognitiveContextAcquireRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  query: z.string().max(4_000).optional(),
  excludeCorrelationId: identifier.optional(),
  /** Maximum classification that may cross the consumer's actual egress. */
  maxPrivacy: z.enum(WORKSPACE_PRIVACY).optional(),
  maxItems: z.number().int().min(0).max(16).optional(),
  maxChars: z.number().int().min(0).max(8_000).optional(),
  minSalience: z.number().finite().min(0).max(1).optional(),
  minConfidence: z.number().finite().min(0).max(1).optional(),
}).strict();

export const cognitiveLeaseRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  leaseId: z.string().uuid(),
}).strict();

export const cognitiveSubscriptionRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  afterRevision: z.number().int().nonnegative().optional(),
  kinds: z.array(z.enum(WORKSPACE_KINDS)).max(WORKSPACE_KINDS.length).optional(),
}).strict();

export const cognitiveSnapshotRequestSchema = cognitiveSubscriptionRequestSchema.extend({
  limit: z.number().int().min(1).max(256).optional(),
}).strict();

export type CognitiveDraft = z.infer<typeof cognitiveDraftSchema>;
export type CognitivePublishRequest = z.infer<typeof cognitivePublishRequestSchema>;
export type CognitiveCancelRequest = z.infer<typeof cognitiveCancelRequestSchema>;
export type CognitiveContextAcquireRequest = z.infer<typeof cognitiveContextAcquireRequestSchema>;
export type CognitiveLeaseRequest = z.infer<typeof cognitiveLeaseRequestSchema>;
export type CognitiveSubscriptionRequest = z.infer<typeof cognitiveSubscriptionRequestSchema>;
export type CognitiveSnapshotRequest = z.infer<typeof cognitiveSnapshotRequestSchema>;
