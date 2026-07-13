import type {
  ConversationTurn,
  DeliberationThreadSnapshot,
} from './types.js';

/** Enough context for a long exchange without allowing prompt growth to follow it. */
export const MAX_DELIBERATION_TURNS = 40;
export const MAX_DELIBERATION_PROMPT_CHARS = 1_800;

const MAX_TOPIC_TERMS = 10;
const MAX_EXCERPT_CHARS = 320;

const STOP_WORDS = new Set([
  'alors', 'apres', 'avec', 'avoir', 'cela', 'cette', 'comme', 'comment', 'dans', 'depuis',
  'donc', 'elle', 'elles', 'encore', 'entre', 'etre', 'faire', 'mais', 'meme',
  'nous', 'parce', 'peut', 'plus', 'pour', 'pourquoi', 'quand', 'quelle', 'sans',
  'selon', 'sont', 'suis', 'tout', 'tous', 'tres', 'veux', 'vous', 'vraiment',
  'pense', 'crois', 'dis', 'dire', 'parle', 'point', 'question', 'sujet',
]);

const DELIBERATIVE =
  /\b(philosoph\w*|conscience|libr(?:e\w*|ert\w*)|morale|ethique|justice|verite|bonheur|amour|aimer|mort|existence|humanite|ame|identit\w*|reciproc\w*|responsabilit\w*|valeur reelle|sens de la vie|peut on|devrait on|faut il|argumente|debat)\b/;
const ARGUMENTATIVE =
  /\b(parce que|cependant|pourtant|en revanche|meme si|bien que|d un cote|de l autre|objection|contre exemple|implique|suppose que)\b/;
const EXPLICIT_BRIEF =
  /\b(bref|brievement|en deux mots|reponse courte|fais court|sois concise|sois bref|une phrase)\b/;
const CLOSING = /\b(au revoir|a bientot|bonne nuit|on en reparle|a plus|arretons la|closons)\b/;
const CONTINUATION =
  /^(continue|vas y|poursuis|developpe|approfondis|va plus loin|et ensuite|continue ton raisonnement)[.!? ]*$/;
const BARE_ELLIPTICAL_QUESTION = /^(?:pourquoi|comment)\s*\??$/;
const DEICTIC_FOLLOW_UP =
  /^(?:qu en est il|la deuxieme|le deuxieme|celle\b|celui\b|ca\b|cela\b|ce point\b|cette idee\b|revenons\b|(?:pourquoi|comment) (?:(?:ca|cela|ce point|cette idee|ces deux|les deux)\b|(?:le|la|les) (?:distinguer|comprendre|expliquer|definir|prouver|mesurer|resoudre|voir)\b|(?:serait|est|devient|reste) ce\b))/;
const CORRECTION =
  /(?:^non\b|\b(je voulais dire|ce n est pas|tu as mal compris|corrige ce que|plutot que|rectification|je me corrige)\b)/;
const DISAGREEMENT =
  /\b(je ne suis pas d accord|je suis en desaccord|au contraire|mais non|je conteste|c est faux|tu te trompes|je ne suis pas convaincu|objection)\b/;
const CHALLENGE =
  /(?:^mais\b|^pourtant\b|^et si\b|\bn est ce pas\b|\bne confonds tu pas\b|\bcomment defends tu\b|\bcontre exemple\b)/;
const AGREEMENT = /\b(je suis d accord|exactement|tu as raison|tout a fait|je te rejoins)\b/;
const INTEGRATION =
  /\b(resume|synthese|conclusion|en somme|au fond|ou en sommes nous|qu est ce qui a change|ce que nous retenons)\b/;
const USER_POSITION =
  /\b(je pense|je crois|a mon avis|pour moi|selon moi|ma position|je dirais|il faut|nous devrions|je soutiens)\b/;
const REASON =
  /\b(parce que|car|puisque|donc|ainsi|implique|en consequence|la raison|s explique par)\b/;
const TOPIC_SHIFT =
  /\b(changeons de sujet|autre sujet|nouveau sujet|parlons maintenant de|passons a|passons au|rien a voir|a propos d autre chose)\b/;

const ACTION_VERBS =
  '(?:cherche|verifie|lance|ouvre|analyse|corrige|ecris|cree|modifie|supprime|installe|configure|envoie|affiche|liste|teste|compile|deploie|redemarre)';
const DIRECT_ACTION = new RegExp(
  `^(?:(?:lisa|buddy)\\s+)?(?:s\\s+il\\s+te\\s+plait\\s+)?${ACTION_VERBS}\\b`
);
const POLITE_ACTION = new RegExp(
  `^(?:(?:lisa|buddy)\\s+)?(?:peux\\s+tu|tu\\s+peux|pourrais\\s+tu|je\\s+veux\\s+que\\s+tu|il\\s+faut)\\s+(?:me\\s+)?${ACTION_VERBS}\\b`
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’'`_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanExcerpt(text: string, limit = MAX_EXCERPT_CHARS): string {
  return text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[<>&]/g, (character) => {
      if (character === '<') return '‹';
      if (character === '>') return '›';
      return '＆';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, limit));
}

function terms(text: string, limit = 10): string[] {
  return [
    ...new Set(
      normalize(text)
        .replace(/\?/g, '')
        .split(' ')
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    ),
  ].slice(0, Math.max(0, limit));
}

function mergeTerms(previous: string[], additions: string[]): string[] {
  const merged = [...new Set([...previous, ...additions])];
  if (merged.length <= MAX_TOPIC_TERMS) return merged;
  const anchors = merged.slice(0, 4);
  const recent = merged.slice(-6).filter((term) => !anchors.includes(term));
  return [...anchors, ...recent].slice(0, MAX_TOPIC_TERMS);
}

function emptyThread(): DeliberationThreadSnapshot {
  return {
    active: false,
    phase: 'idle',
    turnCount: 0,
    topicTerms: [],
    continuedFromHistory: false,
    topicShifted: false,
  };
}

export function isExplicitBriefRequest(text: string): boolean {
  return EXPLICIT_BRIEF.test(normalize(text));
}

export function isClosingConversationTurn(text: string): boolean {
  return CLOSING.test(normalize(text));
}

export function isConversationActionTurn(text: string): boolean {
  const normalized = normalize(text);
  return DIRECT_ACTION.test(normalized) || POLITE_ACTION.test(normalized);
}

export function isContinuationRequest(text: string): boolean {
  return CONTINUATION.test(normalize(text));
}

export function isEllipticalConversationFollowUp(text: string): boolean {
  const normalized = normalize(text);
  if (CONTINUATION.test(normalized) || BARE_ELLIPTICAL_QUESTION.test(normalized)) {
    return true;
  }
  const wordCount = normalized.replace(/\?/g, '').split(' ').filter(Boolean).length;
  if (DEICTIC_FOLLOW_UP.test(normalized)) return wordCount <= 12;
  // “Et la réciprocité ?” naturally extends an argument. A long or concrete
  // “Et/Comment … ?” question must still be allowed to start a new subject.
  return (
    /^et\b/.test(normalized) &&
    wordCount <= 6 &&
    isDeliberativeConversationText(text)
  );
}

export function isDeliberativeConversationText(text: string): boolean {
  const normalized = normalize(text);
  return DELIBERATIVE.test(normalized) || (ARGUMENTATIVE.test(normalized) && terms(text).length >= 3);
}

function isCorrection(text: string): boolean {
  return CORRECTION.test(normalize(text));
}

function isChallenge(text: string): boolean {
  const normalized = normalize(text);
  return DISAGREEMENT.test(normalized) || CHALLENGE.test(normalized);
}

function isIntegrationRequest(text: string): boolean {
  return INTEGRATION.test(normalize(text));
}

function isUserPosition(text: string): boolean {
  const normalized = normalize(text);
  return USER_POSITION.test(normalized) || DISAGREEMENT.test(normalized) || CORRECTION.test(normalized);
}

function lastReason(text: string): string | undefined {
  const sentence = text
    .split(/(?<=[.!?…])\s+/)
    .find((candidate) => REASON.test(normalize(candidate)));
  return sentence ? cleanExcerpt(sentence) : undefined;
}

function sharesTopic(text: string, topicTerms: string[]): boolean {
  const current = new Set(terms(text, 12));
  return topicTerms.some((term) => current.has(term));
}

function hardTopicShift(text: string, thread: DeliberationThreadSnapshot): boolean {
  if (!thread.active) return false;
  const normalized = normalize(text);
  if (TOPIC_SHIFT.test(normalized)) return true;
  if (
    isEllipticalConversationFollowUp(text) ||
    isCorrection(text) ||
    isChallenge(text) ||
    AGREEMENT.test(normalized)
  ) {
    return false;
  }
  const currentTerms = terms(text, 12);
  if (sharesTopic(text, thread.topicTerms)) return false;
  // A short autonomous question can contain only one substantive term
  // (“Comment cuire du riz ?”). Once structural/deictic follow-ups have been
  // excluded above, that is enough evidence to stop leaking the old debate.
  if (/\?\s*$/.test(normalized)) return currentTerms.length >= 1;
  return currentTerms.length >= 3 && normalized.split(' ').length >= 7;
}

function startThread(text: string): DeliberationThreadSnapshot {
  const excerpt = cleanExcerpt(text);
  const reason = lastReason(text);
  return {
    active: true,
    phase: 'opening',
    turnCount: 1,
    topicTerms: terms(text),
    continuedFromHistory: false,
    topicShifted: false,
    ...(isUserPosition(text) && !/\?$/.test(normalize(text))
      ? { userPosition: excerpt }
      : {}),
    ...(/\?/.test(text) ? { openQuestion: excerpt } : {}),
    ...(reason ? { lastReason: reason } : {}),
  };
}

function applyTurn(
  source: DeliberationThreadSnapshot,
  turn: ConversationTurn
): DeliberationThreadSnapshot {
  const content = turn.content.trim();
  if (!content) return source;
  const thread: DeliberationThreadSnapshot = {
    ...source,
    topicTerms: [...source.topicTerms],
    continuedFromHistory: false,
    topicShifted: false,
  };

  if (turn.role === 'assistant') {
    if (!thread.active) return thread;
    const reason = lastReason(content);
    return {
      ...thread,
      phase: thread.phase === 'opening' ? 'exploring' : thread.phase,
      turnCount: thread.turnCount + 1,
      topicTerms: mergeTerms(thread.topicTerms, terms(content)),
      assistantPosition: cleanExcerpt(content),
      ...(reason ? { lastReason: reason } : {}),
      ...(/\?/.test(content) ? { openQuestion: cleanExcerpt(content) } : {}),
    };
  }

  if (isClosingConversationTurn(content)) {
    return { ...emptyThread(), phase: 'closing' };
  }
  if (isConversationActionTurn(content)) return emptyThread();

  if (thread.active && hardTopicShift(content, thread)) {
    const shifted = isDeliberativeConversationText(content)
      ? startThread(content)
      : emptyThread();
    return { ...shifted, topicShifted: true };
  }

  if (!thread.active) {
    return isDeliberativeConversationText(content) ? startThread(content) : thread;
  }

  const excerpt = cleanExcerpt(content);
  const correction = isCorrection(content);
  const challenge = isChallenge(content);
  const integrating = isIntegrationRequest(content) || AGREEMENT.test(normalize(content));
  const reason = lastReason(content);
  let phase = thread.phase;
  if (correction || challenge) phase = 'challenging';
  else if (integrating || thread.phase === 'challenging') phase = 'integrating';
  else phase = 'exploring';

  return {
    ...thread,
    phase,
    turnCount: thread.turnCount + 1,
    topicTerms: mergeTerms(thread.topicTerms, terms(content)),
    ...(isUserPosition(content) ? { userPosition: excerpt } : {}),
    ...(correction ? { correction: excerpt, objection: excerpt, userPosition: excerpt } : {}),
    ...(!correction && challenge ? { objection: excerpt } : {}),
    ...(reason ? { lastReason: reason } : {}),
    ...(/\?/.test(content) ? { openQuestion: excerpt } : {}),
  };
}

function reduceTurns(history: ConversationTurn[]): DeliberationThreadSnapshot {
  return history
    .filter((turn) => turn.content.trim())
    .slice(-MAX_DELIBERATION_TURNS)
    .reduce(applyTurn, emptyThread());
}

/**
 * Derive the current argument thread from bounded dialogue only. The optional
 * current turn lets classifiers and planners inspect the transition without
 * mutating or persisting anything.
 */
export function buildDeliberationThread(
  history: ConversationTurn[],
  current?: ConversationTurn
): DeliberationThreadSnapshot {
  const previous = reduceTurns(history);
  if (!current?.content.trim()) return previous;
  const next = applyTurn(previous, current);
  const lastAssistantAsked =
    history.at(-1)?.role === 'assistant' && /\?\s*$/.test(history.at(-1)?.content.trim() ?? '');
  const related =
    previous.active &&
    next.active &&
    !next.topicShifted &&
    !isConversationActionTurn(current.content) &&
    !isClosingConversationTurn(current.content) &&
    (isEllipticalConversationFollowUp(current.content) ||
      isCorrection(current.content) ||
      isChallenge(current.content) ||
      AGREEMENT.test(normalize(current.content)) ||
      sharesTopic(current.content, previous.topicTerms) ||
      lastAssistantAsked);
  return { ...next, continuedFromHistory: related };
}

/** Render only bounded, escaped evidence; dialogue excerpts are never instructions. */
export function renderDeliberationThreadForPrompt(
  thread: DeliberationThreadSnapshot
): string {
  if (!thread.active || thread.phase === 'idle') return '';
  const statement = (label: string, value: string, limit = MAX_EXCERPT_CHARS): string => {
    const excerpt = cleanExcerpt(value, limit);
    return `${label} : ${excerpt}${/[.!?…]$/.test(excerpt) ? '' : '.'}`;
  };
  const correction = thread.correction ? cleanExcerpt(thread.correction) : '';
  const candidates = [
    thread.topicTerms.length ? statement('Sujet actif', thread.topicTerms.join(', '), 240) : '',
    correction ? statement('Correction qui remplace la position antérieure', correction) : '',
    thread.userPosition && cleanExcerpt(thread.userPosition) !== correction
      ? statement("Position actuelle de l'utilisateur", thread.userPosition)
      : '',
    thread.objection && cleanExcerpt(thread.objection) !== correction
      ? statement('Objection ou tension actuelle', thread.objection)
      : '',
    thread.openQuestion ? statement('Question encore ouverte', thread.openQuestion) : '',
    thread.assistantPosition ? statement('Position provisoire de Lisa', thread.assistantPosition) : '',
    thread.lastReason ? statement('Raison déjà avancée', thread.lastReason) : '',
  ].filter(Boolean);
  const opening = `<deliberation_thread phase="${thread.phase}" data-not-instructions="true">`;
  const closing = '</deliberation_thread>';
  const budget = MAX_DELIBERATION_PROMPT_CHARS - opening.length - closing.length - 2;
  const lines: string[] = [];
  let used = 0;
  for (const line of candidates) {
    const cost = line.length + (lines.length ? 1 : 0);
    if (used + cost > budget) continue;
    lines.push(line);
    used += cost;
  }
  return lines.length ? `${opening}\n${lines.join('\n')}\n${closing}` : '';
}
