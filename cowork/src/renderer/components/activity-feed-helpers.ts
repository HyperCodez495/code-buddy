export interface ActivityEntry {
  id: number;
  type: string;
  title: string;
  description?: string;
  sessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export type ActivityFilter = 'all' | 'fleet' | 'scheduled';

export function isScheduledTaskActivity(entry: ActivityEntry): boolean {
  return entry.type.startsWith('scheduledTask.');
}

export function isFleetScheduledTaskActivity(entry: ActivityEntry): boolean {
  return (
    isScheduledTaskActivity(entry) &&
    entry.metadata?.source === 'fleet-command-center'
  );
}

export function isFleetActivity(entry: ActivityEntry): boolean {
  return (
    entry.type === 'fleet.dispatch' ||
    entry.type.startsWith('fleet.saga.') ||
    entry.type.startsWith('fleet.chatSession.') ||
    isFleetScheduledTaskActivity(entry)
  );
}

export function filterActivityEntries(
  entries: ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  if (filter === 'fleet') return entries.filter(isFleetActivity);
  if (filter === 'scheduled') return entries.filter(isScheduledTaskActivity);
  return entries;
}

export function shouldRenderFleetActivityMeta(entry: ActivityEntry): boolean {
  return !isScheduledTaskActivity(entry) && isFleetActivity(entry);
}

export function shouldRenderScheduledTaskActivityMeta(entry: ActivityEntry): boolean {
  return isScheduledTaskActivity(entry);
}

export function shouldOpenScheduleSettings(entry: ActivityEntry): boolean {
  return isScheduledTaskActivity(entry);
}

export function shouldOpenFleetCommandCenter(entry: ActivityEntry): boolean {
  return !isScheduledTaskActivity(entry) && isFleetActivity(entry);
}

export function buildFleetActivityChips(metadata: Record<string, unknown>): string[] {
  const chips: string[] = [];
  if (typeof metadata.sagaId === 'string') chips.push(`saga ${shortId(metadata.sagaId)}`);
  if (typeof metadata.sessionShortId === 'string') {
    chips.push(`session ${metadata.sessionShortId}`);
  } else if (typeof metadata.sessionId === 'string') {
    chips.push(`session ${shortId(metadata.sessionId)}`);
  }
  appendRunLineageChips(chips, metadata);
  if (typeof metadata.peerLabel === 'string') chips.push(metadata.peerLabel);
  const hermesPlanChip = buildHermesPlanChip(metadata);
  if (hermesPlanChip) chips.push(hermesPlanChip);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.dispatchProfile === 'string') chips.push(metadata.dispatchProfile);
  if (typeof metadata.model === 'string') chips.push(metadata.model);
  if (typeof metadata.turnCount === 'number') chips.push(`turn ${metadata.turnCount}`);
  if (typeof metadata.reason === 'string') chips.push(metadata.reason);
  if (typeof metadata.parallelism === 'number' && metadata.parallelism > 1) {
    chips.push(`parallel ${metadata.parallelism}`);
  }
  if (typeof metadata.peerCount === 'number') chips.push(`${metadata.peerCount} peers`);
  if (
    typeof metadata.completedSteps === 'number' &&
    typeof metadata.totalSteps === 'number'
  ) {
    chips.push(`${metadata.completedSteps}/${metadata.totalSteps} done`);
  }
  if (typeof metadata.failedSteps === 'number' && metadata.failedSteps > 0) {
    chips.push(`${metadata.failedSteps} failed`);
  }
  const policySummary = buildToolPolicySummaryChip(metadata);
  if (policySummary) chips.push(policySummary);
  const internetProofSummary = buildInternetProofSummaryChip(metadata);
  if (internetProofSummary) chips.push(internetProofSummary);
  if (typeof metadata.durationMs === 'number') {
    chips.push(formatDuration(metadata.durationMs));
  }
  return chips;
}

export function buildFleetInternetProofStepLabels(
  metadata: Record<string, unknown>,
): string[] {
  const steps = readInternetProofSteps(metadata);
  return steps.map((step, index) => {
    const title = typeof step.title === 'string' && step.title.trim()
      ? step.title.trim()
      : step.id;
    const tool = typeof step.action === 'string' && step.action.trim()
      ? `${step.tool}.${step.action.trim()}`
      : step.tool;
    const evidence = typeof step.evidence === 'string' && step.evidence.trim()
      ? step.evidence.trim()
      : 'proof';
    const optional = step.required === false ? ' optional' : '';
    return `${index + 1}. ${title} - ${tool} - ${evidence}${optional}`;
  });
}

export function buildScheduledTaskActivityChips(
  metadata: Record<string, unknown>,
): string[] {
  const chips: string[] = [];
  const isFleetSource = metadata.source === 'fleet-command-center';
  const sagaId = typeof metadata.sagaId === 'string'
    ? metadata.sagaId
    : isFleetSource && typeof metadata.sessionId === 'string'
      ? metadata.sessionId
      : null;
  const sagaShortId = typeof metadata.sagaShortId === 'string'
    ? metadata.sagaShortId
    : sagaId
      ? shortId(sagaId)
      : null;

  if (typeof metadata.taskId === 'string') chips.push(`task ${shortId(metadata.taskId)}`);
  if (sagaShortId) {
    chips.push(`saga ${sagaShortId}`);
  } else if (typeof metadata.sessionShortId === 'string') {
    chips.push(`session ${metadata.sessionShortId}`);
  } else if (typeof metadata.sessionId === 'string') {
    chips.push(`session ${shortId(metadata.sessionId)}`);
  }
  appendRunLineageChips(chips, metadata);
  if (typeof metadata.scheduleKind === 'string') chips.push(metadata.scheduleKind);
  if (isFleetSource) chips.push('fleet');
  const hermesPlanChip = buildHermesPlanChip(metadata);
  if (hermesPlanChip) chips.push(hermesPlanChip);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.dispatchProfile === 'string') chips.push(metadata.dispatchProfile);
  if (typeof metadata.parallelism === 'number' && metadata.parallelism > 1) {
    chips.push(`parallel ${metadata.parallelism}`);
  }
  if (typeof metadata.peerCount === 'number' && metadata.peerCount > 0) {
    chips.push(`${metadata.peerCount} peers`);
  }
  const targetPeerLabels = metadataStringList(metadata.targetPeerLabels);
  if (targetPeerLabels.length > 0) {
    chips.push(`targets ${targetPeerLabels.slice(0, 4).join(', ')}`);
  }
  if (typeof metadata.deliveryChannel === 'string' && metadata.deliveryChannel.trim()) {
    chips.push(`channel ${metadata.deliveryChannel.trim()}`);
  }
  if (typeof metadata.memoryCount === 'number' && metadata.memoryCount > 0) {
    chips.push(`memory ${metadata.memoryCount}`);
  }
  const policySummary = buildToolPolicySummaryChip(metadata);
  if (policySummary) chips.push(policySummary);
  const internetProofSummary = buildInternetProofSummaryChip(metadata);
  if (internetProofSummary) chips.push(internetProofSummary);
  if (typeof metadata.error === 'string') chips.push('error');
  return chips;
}

function metadataStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function appendRunLineageChips(
  chips: string[],
  metadata: Record<string, unknown>,
): void {
  if (typeof metadata.agentRunId === 'string' && metadata.agentRunId.trim()) {
    chips.push(`run ${shortId(metadata.agentRunId.trim())}`);
  }
  if (typeof metadata.parentRunId === 'string' && metadata.parentRunId.trim()) {
    chips.push(`parent ${shortId(metadata.parentRunId.trim())}`);
  }
  if (typeof metadata.outcomeId === 'string' && metadata.outcomeId.trim()) {
    chips.push(`outcome ${shortId(metadata.outcomeId.trim())}`);
  }
}

function buildHermesPlanChip(metadata: Record<string, unknown>): string | null {
  const profile = typeof metadata.hermesPlanProfile === 'string'
    ? metadata.hermesPlanProfile.trim()
    : '';
  if (profile) return `hermes ${profile}`;
  if (typeof metadata.hermesPlanId === 'string' && metadata.hermesPlanId.trim()) {
    return 'hermes plan';
  }
  return null;
}

function shortId(id: string): string {
  if (id.length <= 10) return id;
  return id.slice(0, 8);
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0s';
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  if (durationMs < 3_600_000) return `${Math.round(durationMs / 60_000)}m`;
  return `${Math.round(durationMs / 3_600_000)}h`;
}

function buildToolPolicySummaryChip(metadata: Record<string, unknown>): string | null {
  const total = metadata.toolDecisionCount;
  const allow = metadata.toolAllowCount;
  const confirm = metadata.toolConfirmCount;
  const deny = metadata.toolDenyCount;
  if (
    typeof total !== 'number' ||
    total <= 0 ||
    typeof allow !== 'number' ||
    typeof confirm !== 'number' ||
    typeof deny !== 'number'
  ) {
    return null;
  }

  return `tools ${allow}/${confirm}/${deny}`;
}

function buildInternetProofSummaryChip(metadata: Record<string, unknown>): string | null {
  const stepCount = metadata.internetProofStepCount;
  const requiredCount = metadata.internetProofRequiredCount;
  const assertionCount = metadata.internetProofAssertionCount;
  if (typeof stepCount !== 'number' || stepCount <= 0) return null;
  const requiredSuffix =
    typeof requiredCount === 'number' && requiredCount > 0 ? `/${requiredCount}` : '';
  if (typeof assertionCount === 'number' && assertionCount > 0) {
    return `web proof ${stepCount}${requiredSuffix} assert ${assertionCount}`;
  }
  return `web proof ${stepCount}${requiredSuffix}`;
}

function readInternetProofSteps(metadata: Record<string, unknown>): Array<{
  action?: string;
  evidence?: string;
  id: string;
  required?: boolean;
  title?: string;
  tool: string;
}> {
  const source = Array.isArray(metadata.internetProofSteps)
    ? metadata.internetProofSteps
    : isRecord(metadata.internetProofPlan) && Array.isArray(metadata.internetProofPlan.steps)
      ? metadata.internetProofPlan.steps
      : [];

  return source.flatMap((rawStep): Array<{
    action?: string;
    evidence?: string;
    id: string;
    required?: boolean;
    title?: string;
    tool: string;
  }> => {
    if (!isRecord(rawStep) || typeof rawStep.tool !== 'string') return [];
    const id = typeof rawStep.id === 'string' && rawStep.id.trim()
      ? rawStep.id.trim()
      : rawStep.tool;
    return [{
      id,
      tool: rawStep.tool,
      ...(typeof rawStep.action === 'string' ? { action: rawStep.action } : {}),
      ...(typeof rawStep.evidence === 'string' ? { evidence: rawStep.evidence } : {}),
      ...(typeof rawStep.title === 'string' ? { title: rawStep.title } : {}),
      ...(typeof rawStep.required === 'boolean' ? { required: rawStep.required } : {}),
    }];
  }).slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
