import type { TFunction } from 'i18next';
import type {
  ScheduleConfig,
  ScheduleRepeatUnit,
  ScheduleTask,
  ScheduleWeekday,
} from '../../types';
import { formatAppDateTime, joinAppList } from '../../utils/i18n-format';
import type { ScheduleFormMode } from './shared';

export function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function buildScheduleMetadataChips(task: ScheduleTask, t: TFunction): string[] {
  return buildScheduleMetadataChipsFromMetadata(task.metadata, t);
}

export function buildScheduleMetadataChipsFromMetadata(
  metadata: Record<string, unknown> | null,
  t: TFunction,
): string[] {
  const safeMetadata = metadata ?? {};
  const chips: string[] = [];
  if (safeMetadata.source === 'fleet-command-center') {
    chips.push(t('schedule.sourceFleet'));
  }
  const hermesPlanProfile = metadataString(safeMetadata, 'hermesPlanProfile');
  if (metadataString(safeMetadata, 'hermesPlanId') || hermesPlanProfile) {
    chips.push(t('schedule.hermesPlanChip', { value: hermesPlanProfile ?? 'plan' }));
  }
  if (typeof safeMetadata.dispatchProfile === 'string') {
    chips.push(t('schedule.profileChip', { value: safeMetadata.dispatchProfile }));
  }
  if (typeof safeMetadata.privacyTag === 'string') {
    chips.push(t('schedule.privacyChip', { value: safeMetadata.privacyTag }));
  }
  if (typeof safeMetadata.parallelism === 'number' && safeMetadata.parallelism > 1) {
    chips.push(t('schedule.parallelismChip', { value: safeMetadata.parallelism }));
  }
  if (typeof safeMetadata.peerCount === 'number' && safeMetadata.peerCount > 0) {
    chips.push(t('schedule.peerCountChip', { count: safeMetadata.peerCount }));
  }
  const targetPeerLabels = metadataStringList(safeMetadata, 'targetPeerLabels');
  if (targetPeerLabels.length > 0) {
    chips.push(
      t('schedule.targetPeersChip', {
        value: joinAppList(targetPeerLabels.slice(0, 4)),
        count: targetPeerLabels.length,
      }),
    );
  }
  const deliveryChannel = metadataString(safeMetadata, 'deliveryChannel');
  if (deliveryChannel) {
    chips.push(t('schedule.deliveryChannelChip', { value: deliveryChannel }));
  }
  if (typeof safeMetadata.memoryCount === 'number' && safeMetadata.memoryCount > 0) {
    chips.push(t('schedule.memoryChip', { count: safeMetadata.memoryCount }));
  }
  const webProofChip = buildScheduleWebProofChip(safeMetadata, t);
  if (webProofChip) chips.push(webProofChip);
  return chips;
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildScheduleWebProofChip(
  metadata: Record<string, unknown>,
  t: TFunction,
): string | null {
  const stepCount = metadata.internetProofStepCount;
  const requiredCount = metadata.internetProofRequiredCount;
  const assertionCount = metadata.internetProofAssertionCount;
  if (typeof stepCount !== 'number' || stepCount <= 0) return null;
  const requiredSuffix =
    typeof requiredCount === 'number' && requiredCount > 0 ? `/${requiredCount}` : '';
  if (typeof assertionCount === 'number' && assertionCount > 0) {
    return t('schedule.webProofAssertChip', {
      steps: stepCount,
      required: requiredSuffix,
      assertions: assertionCount,
    });
  }
  return t('schedule.webProofChip', {
    steps: stepCount,
    required: requiredSuffix,
  });
}

export function formatTime(timestamp: number): string {
  return formatAppDateTime(timestamp);
}

export function formatScheduleRule(
  task: ScheduleTask,
  t: TFunction,
  weekdayOptions: Array<{ value: ScheduleWeekday; label: string }>,
): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return t('schedule.ruleDaily', { times: joinAppList(task.scheduleConfig.times) });
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    const weekdays = task.scheduleConfig.weekdays.map(
      (weekday) =>
        weekdayOptions.find((option) => option.value === weekday)?.label ??
        t('schedule.unknownWeekday'),
    );
    return t('schedule.ruleWeekly', {
      weekdays: joinAppList(weekdays),
      times: joinAppList(task.scheduleConfig.times),
    });
  }
  if (!task.repeatEvery || !task.repeatUnit) {
    return t('schedule.ruleOnce');
  }
  if (task.repeatUnit === 'minute') {
    return t('schedule.repeatEveryMinute', { count: task.repeatEvery });
  }
  if (task.repeatUnit === 'hour') {
    return t('schedule.repeatEveryHour', { count: task.repeatEvery });
  }
  return t('schedule.repeatEveryDay', { count: task.repeatEvery });
}

export function detectScheduleMode(task: ScheduleTask): ScheduleFormMode {
  if (task.scheduleConfig?.kind === 'daily') {
    return 'daily';
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return 'weekly';
  }
  if (task.repeatEvery && task.repeatUnit) {
    return 'legacy-interval';
  }
  return 'once';
}

export function buildScheduleConfigFromForm(
  mode: ScheduleFormMode,
  times: string[],
  weekdays: ScheduleWeekday[],
): ScheduleConfig | null {
  const normalizedTimes = Array.from(new Set(times.filter(isValidTimeValue))).sort();
  if (mode === 'daily' && normalizedTimes.length > 0) {
    return { kind: 'daily', times: normalizedTimes };
  }
  if (mode === 'weekly' && normalizedTimes.length > 0 && weekdays.length > 0) {
    return {
      kind: 'weekly',
      weekdays: Array.from(new Set(weekdays)).sort((left, right) => left - right),
      times: normalizedTimes,
    };
  }
  return null;
}

export function buildScheduleSignatureFromTask(task: ScheduleTask): string {
  if (task.scheduleConfig) {
    return JSON.stringify(task.scheduleConfig);
  }
  if (task.repeatEvery && task.repeatUnit) {
    return JSON.stringify({
      mode: 'legacy-interval',
      runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
    });
  }
  return JSON.stringify({
    mode: 'once',
    runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
  });
}

export function buildScheduleSignatureFromForm(
  mode: ScheduleFormMode,
  runAt: string,
  times: string[],
  weekdays: ScheduleWeekday[],
  repeatEvery: number,
  repeatUnit: ScheduleRepeatUnit,
): string {
  if (mode === 'daily' || mode === 'weekly') {
    return JSON.stringify(buildScheduleConfigFromForm(mode, times, weekdays));
  }
  if (mode === 'legacy-interval') {
    return JSON.stringify({ mode, runAt, repeatEvery, repeatUnit });
  }
  return JSON.stringify({ mode, runAt });
}

export function buildSchedulePreview(
  mode: ScheduleFormMode,
  runAt: string,
  scheduleConfig: ScheduleConfig | null,
  t: TFunction,
): string {
  if (mode === 'once' || mode === 'legacy-interval') {
    const timestamp = new Date(runAt).getTime();
    return Number.isFinite(timestamp)
      ? t('schedule.previewNextRun', { value: formatTime(timestamp) })
      : t('schedule.previewSelectValidTime');
  }
  const nextRunAt = computeNextScheduledRun(scheduleConfig, Date.now());
  return nextRunAt === null
    ? t('schedule.previewSelectAtLeastOne')
    : t('schedule.previewAutoFind', { value: formatTime(nextRunAt) });
}

export function computeNextScheduledRun(
  scheduleConfig: ScheduleConfig | null,
  now: number,
): number | null {
  if (!scheduleConfig || scheduleConfig.times.length === 0) {
    return null;
  }
  const allowedWeekdays =
    scheduleConfig.kind === 'weekly' ? new Set(scheduleConfig.weekdays) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0,
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduleWeekday)) {
      continue;
    }
    for (const time of scheduleConfig.times) {
      if (!isValidTimeValue(time)) {
        continue;
      }
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0,
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}

export function toggleTimeValue(current: string[], target: string): string[] {
  if (!isValidTimeValue(target)) {
    return current;
  }
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort();
}

export function toggleWeekdayValue(
  current: ScheduleWeekday[],
  target: ScheduleWeekday,
): ScheduleWeekday[] {
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort((left, right) => left - right);
}

export function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}
