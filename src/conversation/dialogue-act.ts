import type {
  ConversationAnalysis,
  ConversationDepth,
  ConversationTurn,
  DialogueAct,
} from './types.js';
import {
  buildDeliberationThread,
  isClosingConversationTurn,
  isConversationActionTurn,
  isContinuationRequest,
  isEllipticalConversationFollowUp,
  isExplicitBriefRequest,
} from './deliberation-thread.js';

const FRENCH_STOP_WORDS = new Set([
  'alors', 'apres', 'avec', 'avoir', 'cette', 'comme', 'dans', 'depuis', 'elle', 'elles',
  'encore', 'entre', 'etre', 'faire', 'mais', 'meme', 'nous', 'pour', 'pourquoi', 'quand',
  'quelle', 'quelles', 'sans', 'selon', 'sont', 'suis', 'tout', 'tous', 'tres', 'veux',
  'vous', 'vraiment', 'cela', 'ceci', 'donc', 'peut', 'plus', 'moins', 'dire', 'parle',
]);

export function normalizeConversationText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’'`_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSalientTerms(text: string, limit = 6): string[] {
  const tokens = normalizeConversationText(text)
    .replace(/\?/g, '')
    .split(' ')
    .filter((token) => token.length >= 4 && !FRENCH_STOP_WORDS.has(token));
  return [...new Set(tokens)].slice(0, Math.max(0, limit));
}

const PHATIC = /^(bonjour|bonsoir|salut|coucou|hello|merci|d accord|ok|okay|ca va|bonne nuit)\b/;
const PURE_ACKNOWLEDGEMENT = /^(?:oui|ouais|yes|yeah|yep|yup|ok|okay|d accord|mhm|mhmm|mmhmm|mm hmm|uhuh|uh huh)\??$/;
const BACKCHANNEL = /^(?:exactement|je vois|hum|hmm|ah bon)\??$/;
const CLOSING = /\b(au revoir|a bientot|bonne nuit|on en reparle|a plus)\b/;
const CORRECTION =
  /(?:^non\b|\b(je voulais dire|ce n est pas|tu as mal compris|corrige ce que|plutot que|rectification)\b)/;
const CLARIFICATION = /\b(que veux tu dire|tu parles de|si je comprends|est ce que tu veux dire)\b/;
const DISAGREEMENT =
  /\b(je ne suis pas d accord|je suis en desaccord|au contraire|mais non|je conteste|c est faux|tu te trompes)\b/;
const AGREEMENT = /\b(je suis d accord|exactement|tu as raison|c est aussi mon avis|tout a fait)\b/;
const EMOTIONAL =
  /\b(je me sens(?:\s+\w+){0,4}|je suis (?:(?:tres|vraiment|un peu|tellement|completement|plutot) )?(?:triste|heureux|heureuse|seul|seule|fatigue|fatiguee|epuise|epuisee|angoisse|angoissee|anxieux|anxieuse)|j ai peur|j ai de l angoisse|je n ai pas le moral|je ne vais pas bien|ca me touche|je souffre|je t aime)\b/;
const FRESH =
  /\b(actualite|actualites|news|nouvelles|gros titres|aujourd hui|en ce moment|actuellement|derniere minute|meteo|temperature|agenda|rendez vous|prix|bourse|cours de|president|premier ministre)\b/;
const ACTION =
  /\b(cherche|verifie|lance|ouvre|lis|analyse|corrige|ecris|cree|modifie|supprime|installe|configure|envoie|affiche|liste|teste|compile|deploie|redemarre)\b/;
const OPINION =
  /\b(a ton avis|selon toi|penses tu|crois tu|que penses tu|ton opinion|ton point de vue|es tu d accord)\b/;
const DELIBERATIVE =
  /\b(philosoph\w*|conscience|libr(?:e\w*|ert\w*)|morale|ethique|justice|verite|bonheur|amour|aimer|mort|existence|humanite|ame|identit\w*|reciproc\w*|responsabilit\w*|sens de la vie|peut on|devrait on|faut il|argumente|debat)\b/;
const QUESTION =
  /\b(comment|pourquoi|combien|qui|quand|quel|quelle|quels|quelles|est ce que|qu est ce que|c est quoi)\b/;
const EXPLICIT_BRIEF = /\b(bref|brievement|en deux mots|reponse courte|fais court|sois concise)\b/;
const EXPLICIT_DEVELOPED =
  /\b(developpe|en detail|approfondis|argumente|explique vraiment|analyse en profondeur)\b/;
const FOLLOW_UP = /^(?:mais|donc)\b/;

/**
 * A transcript that only acknowledges the preceding turn. Speech recognition
 * commonly keeps these English/non-lexical forms even in an otherwise French
 * conversation. Deliberate continuation requests are intentionally excluded:
 * "continue" and "vas-y" carry an instruction to advance the discussion.
 */
export function isPureAcknowledgement(text: string): boolean {
  return PURE_ACKNOWLEDGEMENT.test(normalizeConversationText(text));
}

function dialogueAct(text: string, normalized: string): DialogueAct {
  if (CORRECTION.test(normalized)) return 'correction';
  if (CLARIFICATION.test(normalized)) return 'clarification';
  if (DISAGREEMENT.test(normalized)) return 'disagreement';
  if (AGREEMENT.test(normalized)) return 'agreement';
  if (EMOTIONAL.test(normalized)) return 'emotional_disclosure';
  if (FRESH.test(normalized)) return 'fresh_information';
  if (CLOSING.test(normalized) || isClosingConversationTurn(text)) return 'closing';
  if (isConversationActionTurn(text)) return 'action';
  if (OPINION.test(normalized) || DELIBERATIVE.test(normalized)) return 'opinion';
  if (ACTION.test(normalized)) return 'action';
  if (isContinuationRequest(text)) return 'continuation';
  if (isPureAcknowledgement(text) || BACKCHANNEL.test(normalized)) return 'backchannel';
  if (PHATIC.test(normalized) && normalized.split(' ').length <= 5) return 'phatic';
  if (text.trim().endsWith('?') || QUESTION.test(normalized)) return 'question';
  return 'opinion';
}

function conversationDepth(act: DialogueAct, normalized: string): ConversationDepth {
  if (
    EXPLICIT_BRIEF.test(normalized) ||
    act === 'phatic' ||
    act === 'backchannel' ||
    act === 'continuation' ||
    act === 'closing'
  ) {
    return 'brief';
  }
  if (
    EXPLICIT_DEVELOPED.test(normalized) ||
    DELIBERATIVE.test(normalized) ||
    act === 'disagreement'
  ) {
    return 'deliberative';
  }
  if (act === 'fresh_information' || act === 'emotional_disclosure' || act === 'opinion') {
    return 'developed';
  }
  return 'standard';
}

export function analyzeConversationTurn(
  text: string,
  history: ConversationTurn[] = []
): ConversationAnalysis {
  const normalized = normalizeConversationText(text);
  const act = dialogueAct(text, normalized);
  const lastTurn = history.at(-1);
  const deliberation = buildDeliberationThread(history, { role: 'user', content: text });
  const isFollowUp =
    !deliberation.topicShifted &&
    (FOLLOW_UP.test(normalized) ||
      isEllipticalConversationFollowUp(text) ||
      deliberation.continuedFromHistory ||
      Boolean(lastTurn?.role === 'assistant' && /\?\s*$/.test(lastTurn.content.trim())));
  const inheritanceCancelled =
    isExplicitBriefRequest(text) ||
    act === 'action' ||
    act === 'closing' ||
    act === 'phatic' ||
    act === 'backchannel' ||
    isClosingConversationTurn(text);
  const continuesDeliberation =
    deliberation.continuedFromHistory && !inheritanceCancelled;
  const depth = continuesDeliberation
    ? 'deliberative'
    : conversationDepth(act, normalized);

  return {
    act,
    depth,
    needsFreshContext: act === 'fresh_information',
    isEmotional: act === 'emotional_disclosure',
    isFollowUp,
    continuesDeliberation,
    deliberationPhase: deliberation.phase,
    confidence: normalized ? 0.82 : 0,
    salientTerms: extractSalientTerms(text),
  };
}
