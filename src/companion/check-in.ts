import { createCompanionCard, type CompanionCard } from './cards.js';
import {
  buildCompanionImpulseBrief,
  type CompanionImpulse,
  type CompanionImpulseBrief,
  type CompanionImpulsePriority,
} from './impulses.js';
import {
  readRecentCompanionPercepts,
  recordCompanionPercept,
  type CompanionPercept,
} from './percepts.js';
import { recordCompanionSafetyEvent, type CompanionSafetyEvent } from './safety-ledger.js';
import { resolveUserName } from './user-name.js';

export type CompanionCheckInMood = 'steady' | 'encouraging' | 'urgent' | 'curious';

export interface CompanionCheckInEvidence {
  label: string;
  value: string;
}

export interface CompanionCheckInCue {
  id: string;
  timestamp: string;
  cwd: string;
  mood: CompanionCheckInMood;
  priority: CompanionImpulsePriority;
  spokenText: string;
  writtenText: string;
  nextPrompt: string;
  suggestedCommand?: string;
  sourceImpulseId?: string;
  sourceImpulseTitle?: string;
  evidence: CompanionCheckInEvidence[];
  brief: CompanionImpulseBrief;
  percept?: CompanionPercept;
  card?: CompanionCard;
  safetyEvent?: CompanionSafetyEvent;
}

export interface CompanionCheckInOptions {
  cwd?: string;
  now?: Date;
  userText?: string;
  recordPercept?: boolean;
  createCard?: boolean;
  recordSafety?: boolean;
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function checkInId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '');
  return `companion-check-in-${stamp}`;
}

function compactText(text: string | undefined, max = 260): string {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 15)}... [truncated]`;
}

function detectUserMood(userText: string | undefined): CompanionCheckInMood | null {
  const text = (userText || '').toLowerCase();
  if (!text) return null;
  if (
    /(bloque|coince|fatigue|epuise|stress|peur|angoisse|frustr|dur|hard|stuck|tired|anxious|afraid)/i.test(
      text
    )
  ) {
    return 'encouraging';
  }
  if (/[?]|quoi|idee|pense|avis|suggest|what|why|how|idea/.test(text)) {
    return 'curious';
  }
  return 'steady';
}

function moodFor(
  impulse: CompanionImpulse | undefined,
  userText: string | undefined
): CompanionCheckInMood {
  const userMood = detectUserMood(userText);
  if (userMood) return userMood;
  if (impulse?.priority === 'high') return 'urgent';
  if (impulse?.kind === 'sense' || impulse?.kind === 'conversation') return 'curious';
  return 'steady';
}

function priorityFor(impulse: CompanionImpulse | undefined): CompanionImpulsePriority {
  return impulse?.priority || 'low';
}

function latestByModality(
  percepts: CompanionPercept[],
  modality: CompanionPercept['modality']
): CompanionPercept | undefined {
  return percepts.find((percept) => percept.modality === modality);
}

function evidenceFrom(
  impulse: CompanionImpulse | undefined,
  recent: CompanionPercept[],
  brief: CompanionImpulseBrief
): CompanionCheckInEvidence[] {
  const evidence: CompanionCheckInEvidence[] = [];
  if (impulse) {
    evidence.push({
      label: 'impulse',
      value: `${impulse.priority}/${impulse.kind}: ${impulse.title}`,
    });
    evidence.push(...impulse.evidence.slice(0, 3));
  }
  const latestVision = latestByModality(recent, 'vision');
  const latestHearing = latestByModality(recent, 'hearing');
  const latestSelf = latestByModality(recent, 'self');
  if (latestVision) evidence.push({ label: 'latest vision', value: latestVision.timestamp });
  if (latestHearing) evidence.push({ label: 'latest hearing', value: latestHearing.timestamp });
  if (latestSelf) evidence.push({ label: 'latest self', value: latestSelf.timestamp });
  evidence.push({ label: 'memory', value: `${brief.context.perceptTotal} percept(s)` });
  evidence.push({
    label: 'missions',
    value: `${brief.context.openMissions} open, ${brief.context.inProgressMissions} active`,
  });
  return evidence;
}

function spokenFor(
  mood: CompanionCheckInMood,
  impulse: CompanionImpulse | undefined,
  brief: CompanionImpulseBrief,
  userText: string | undefined
): string {
  const message = impulse?.message || brief.nextPrompt;
  const userLead = userText ? `Je t'entends: ${compactText(userText, 110)}. ` : '';
  if (mood === 'urgent') {
    return `${userLead}${resolveUserName()}, point rapide: ${message}`;
  }
  if (mood === 'encouraging') {
    return `${userLead}On garde les choses simples. Mon prochain mouvement utile: ${message}`;
  }
  if (mood === 'curious') {
    return `${userLead}J'ai une piste a te proposer: ${message}`;
  }
  return `${userLead}Je suis la. ${message}`;
}

function writtenFor(
  spokenText: string,
  evidence: CompanionCheckInEvidence[],
  impulse: CompanionImpulse | undefined
): string {
  const lines = [
    spokenText,
    '',
    'Evidence:',
    ...evidence.slice(0, 8).map((item) => `- ${item.label}: ${item.value}`),
  ];
  if (impulse?.command) {
    lines.push('', `Suggested command: ${impulse.command}`);
  }
  return lines.join('\n');
}

export async function buildCompanionCheckIn(
  options: CompanionCheckInOptions = {}
): Promise<CompanionCheckInCue> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const [brief, recent] = await Promise.all([
    buildCompanionImpulseBrief({ cwd, now, recordSuggestions: false }),
    readRecentCompanionPercepts({ cwd, limit: 12 }),
  ]);
  const impulse = brief.impulses[0];
  const mood = moodFor(impulse, options.userText);
  const priority = priorityFor(impulse);
  const evidence = evidenceFrom(impulse, recent, brief);
  const spokenText = spokenFor(mood, impulse, brief, options.userText);
  const writtenText = writtenFor(spokenText, evidence, impulse);

  let cue: CompanionCheckInCue = {
    id: checkInId(now),
    timestamp: now.toISOString(),
    cwd,
    mood,
    priority,
    spokenText,
    writtenText,
    nextPrompt: brief.nextPrompt,
    suggestedCommand: impulse?.command,
    sourceImpulseId: impulse?.id,
    sourceImpulseTitle: impulse?.title,
    evidence,
    brief,
  };

  if (options.recordPercept !== false) {
    const percept = await recordCompanionPercept(
      {
        modality: 'suggestion',
        source: 'companion_check_in',
        summary: spokenText,
        confidence: priority === 'high' ? 0.95 : priority === 'medium' ? 0.85 : 0.72,
        payload: {
          cueId: cue.id,
          mood,
          priority,
          sourceImpulseId: impulse?.id,
          suggestedCommand: impulse?.command,
          userTextPreview: compactText(options.userText, 500),
          evidence,
        },
        tags: ['check-in', 'conversation', 'proactive', mood, priority],
      },
      { cwd, now }
    );
    cue = { ...cue, percept };
  }

  if (options.createCard !== false) {
    const card = await createCompanionCard(
      {
        kind: 'status',
        title: mood === 'urgent' ? 'Buddy check-in urgent' : 'Buddy check-in',
        body: spokenText,
        priority,
        actions: impulse?.command
          ? [
              {
                id: 'run-suggestion',
                label: 'Run',
                command: impulse.command,
                style: priority === 'high' ? 'primary' : 'secondary',
              },
            ]
          : [],
        payload: {
          cueId: cue.id,
          mood,
          sourceImpulseId: impulse?.id,
        },
        tags: ['check-in', 'conversation', 'proactive', mood],
      },
      { cwd, now }
    );
    cue = { ...cue, card };
  }

  if (options.recordSafety !== false) {
    const safetyEvent = await recordCompanionSafetyEvent(
      {
        kind: 'tool',
        risk: priority === 'high' ? 'medium' : 'low',
        action: 'companion_check_in',
        reason: 'Prepared a proactive companion check-in from local workspace state.',
        status: 'completed',
        source: 'companion_check_in',
        payload: {
          cueId: cue.id,
          mood,
          priority,
          sourceImpulseId: impulse?.id,
          cardId: cue.card?.id,
          perceptId: cue.percept?.id,
        },
        tags: ['check-in', 'conversation', 'proactive', mood],
      },
      { cwd, now }
    );
    cue = { ...cue, safetyEvent };
  }

  return cue;
}

export function formatCompanionCheckIn(cue: CompanionCheckInCue): string {
  const lines = [
    'Buddy Companion Check-in',
    '='.repeat(50),
    '',
    `Workspace: ${cue.cwd}`,
    `Cue: ${cue.id}`,
    `Mood: ${cue.mood}`,
    `Priority: ${cue.priority}`,
    '',
    'Spoken:',
    cue.spokenText,
    '',
    'Written:',
    cue.writtenText,
  ];
  if (cue.suggestedCommand) lines.push('', `Suggested command: ${cue.suggestedCommand}`);
  if (cue.percept) lines.push(`Percept: ${cue.percept.id}`);
  if (cue.card) lines.push(`Card: ${cue.card.id}`);
  if (cue.safetyEvent) lines.push(`Safety event: ${cue.safetyEvent.id}`);
  return lines.join('\n');
}
