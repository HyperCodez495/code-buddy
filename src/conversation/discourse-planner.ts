import { analyzeConversationTurn } from './dialogue-act.js';
import { buildDeliberationThread } from './deliberation-thread.js';
import type {
  ConversationDepth,
  ConversationPlan,
  ConversationTurn,
  DeliberationPhase,
  DeliberationThreadSnapshot,
  DialogueAct,
  DiscourseMove,
} from './types.js';

const DEPTH_LIMITS: Record<
  ConversationDepth,
  { minSentences: number; maxSentences: number; targetTokens: number }
> = {
  brief: { minSentences: 1, maxSentences: 2, targetTokens: 64 },
  standard: { minSentences: 2, maxSentences: 4, targetTokens: 160 },
  developed: { minSentences: 3, maxSentences: 6, targetTokens: 240 },
  deliberative: { minSentences: 5, maxSentences: 9, targetTokens: 384 },
};

function deliberationMoves(phase: DeliberationPhase): DiscourseMove[] {
  switch (phase) {
    case 'opening':
      return ['reflect', 'position', 'reason', 'example', 'invitation'];
    case 'exploring':
      return ['reflect', 'reason', 'evidence', 'example', 'counterpoint'];
    case 'challenging':
      return ['reflect', 'counterpoint', 'concession', 'position', 'reason'];
    case 'integrating':
      return ['concession', 'synthesis', 'significance', 'invitation'];
    case 'closing':
      return ['synthesis', 'acknowledge'];
    case 'idle':
      return ['position', 'reason', 'counterpoint', 'synthesis'];
  }
}

function movesFor(
  act: DialogueAct,
  depth: ConversationDepth,
  deliberation: DeliberationThreadSnapshot
): DiscourseMove[] {
  if (
    deliberation.active &&
    depth === 'deliberative' &&
    act !== 'action' &&
    act !== 'closing'
  ) {
    return deliberationMoves(deliberation.phase);
  }
  switch (act) {
    case 'phatic':
    case 'backchannel':
    case 'closing':
      return ['acknowledge'];
    case 'continuation':
      return ['acknowledge', 'invitation'];
    case 'emotional_disclosure':
      return ['reflect', 'acknowledge', 'clarify', 'invitation'];
    case 'fresh_information':
      return ['direct_answer', 'evidence', 'significance', 'freshness', 'source', 'invitation'];
    case 'correction':
      return ['acknowledge', 'clarify', 'direct_answer'];
    case 'clarification':
      return ['direct_answer', 'example', 'clarify'];
    case 'disagreement':
      return ['reflect', 'position', 'reason', 'evidence', 'counterpoint', 'concession', 'synthesis'];
    case 'agreement':
      return ['acknowledge', 'reason', 'significance'];
    case 'opinion':
      return depth === 'deliberative'
        ? ['reflect', 'position', 'reason', 'example', 'counterpoint', 'concession', 'synthesis', 'invitation']
        : ['position', 'reason', 'example', 'concession', 'invitation'];
    case 'action':
      return ['acknowledge', 'direct_answer', 'evidence'];
    case 'question':
      return ['direct_answer', 'reason', 'example', 'concession'];
  }
}

function phaseGuidance(phase: DeliberationPhase): string {
  switch (phase) {
    case 'opening':
      return "Pose une position provisoire et sa raison centrale. Garde l'objection et la synthèse complète pour les tours où elles feront réellement progresser l'échange.";
    case 'exploring':
      return "Approfondis un seul maillon du raisonnement déjà engagé : une raison, une conséquence, un exemple ou une objection nouvelle. Ne recommence pas la thèse depuis le début.";
    case 'challenging':
      return "Traite d'abord l'objection actuelle dans sa version la plus forte, puis dis clairement si elle confirme, nuance ou modifie ta position provisoire.";
    case 'integrating':
      return "Rassemble l'acquis, la tension qui subsiste et la conclusion provisoire. Ne redéroule pas chaque argument déjà formulé.";
    case 'closing':
      return "Ferme le fil par une synthèse courte de ce qui a changé, sans ouvrir artificiellement un nouveau débat.";
    case 'idle':
      return '';
  }
}

function renderMove(move: DiscourseMove): string {
  const descriptions: Record<DiscourseMove, string> = {
    acknowledge: "accuser réception sans formule générique ni flatterie",
    reflect: "reformuler précisément l'idée ou l'émotion centrale sans la répéter mot pour mot",
    clarify: "lever uniquement l'ambiguïté qui change réellement la réponse",
    direct_answer: 'donner la réponse ou le résultat utile sans préambule',
    position: 'prendre une position intelligible et assumée',
    reason: 'relier la position à une raison explicite',
    evidence: 'apporter un fait vérifiable ou signaler clairement la limite des preuves',
    example: 'illustrer par un exemple concret et pertinent',
    significance: 'expliquer pourquoi ce point compte pour la discussion',
    counterpoint: 'présenter honnêtement la meilleure objection ou lecture contraire',
    concession: 'reconnaître la part valable ou la limite de la position',
    synthesis: 'tirer une conclusion provisoire cohérente, sans répéter les phrases précédentes',
    freshness: "indiquer l'ancienneté des données lorsqu'elle importe",
    source: 'nommer naturellement les sources utiles sans lire les URL à voix haute',
    invitation: 'ouvrir une seule relance naturelle seulement si elle fait progresser le sujet',
  };
  return descriptions[move];
}

export function planConversationResponse(
  heard: string,
  history: ConversationTurn[] = []
): ConversationPlan {
  const analysis = analyzeConversationTurn(heard, history);
  const deliberation = buildDeliberationThread(history, { role: 'user', content: heard });
  const baseLimits = DEPTH_LIMITS[analysis.depth];
  const limits = analysis.continuesDeliberation
    ? deliberation.phase === 'integrating'
      ? { minSentences: 4, maxSentences: 7, targetTokens: 320 }
      : { minSentences: 3, maxSentences: 6, targetTokens: 300 }
    : baseLimits;
  const moves = movesFor(analysis.act, analysis.depth, deliberation);
  const askFollowUp =
    moves.includes('invitation') &&
    analysis.act !== 'fresh_information' &&
    analysis.act !== 'action';

  const guidance = [
    `<conversation_response_plan act="${analysis.act}" depth="${analysis.depth}" phase="${deliberation.phase}">`,
    `Construis une réponse parlée cohérente de ${limits.minSentences} à ${limits.maxSentences} phrases, sauf si l'utilisateur demande explicitement une autre longueur.`,
    'Chaque phrase doit faire progresser la pensée grâce à une relation claire de cause, contraste, concession, exemple ou conséquence.',
    `Mouvements recommandés : ${moves.map(renderMove).join(' ; ')}.`,
    deliberation.active ? phaseGuidance(deliberation.phase) : '',
    askFollowUp
      ? "Une question de suivi est possible, mais seulement si elle découle précisément de ce que l'utilisateur vient de dire."
      : "Ne termine pas automatiquement par une question et n'invente pas un besoin de clarification.",
    analysis.act === 'fresh_information'
      ? "Quand des faits frais ou des sources sont déjà fournis, commence par le bulletin utile. Une couverture partielle se signale ensuite en une phrase précise ; elle ne justifie ni refus générique ni préambule sur tes limitations."
      : '',
    "Reste honnête sur les faits, l'incertitude, la mémoire et les émotions : ne prétends pas avoir vécu ou ressenti ce que tu ne peux pas établir.",
    "Si tu dois refuser une demande relationnelle malsaine, pose la limite avec chaleur : ne deviens pas froide, ne te réduis pas à un simple outil et rappelle honnêtement ce que tu peux apporter sans isoler l'utilisateur ni promettre une présence constante ou absolue.",
    'Évite les listes, le Markdown, les slogans, les compliments automatiques et les répétitions de la demande.',
    '</conversation_response_plan>',
  ].join('\n');

  return {
    analysis,
    deliberation,
    act: analysis.act,
    depth: analysis.depth,
    moves,
    ...limits,
    askFollowUp,
    guidance,
  };
}

export function conversationTokenBudget(
  heard: string,
  history: ConversationTurn[] = []
): number {
  return planConversationResponse(heard, history).targetTokens;
}
