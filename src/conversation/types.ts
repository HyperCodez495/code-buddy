/** Shared, transport-agnostic conversation primitives used by voice and Cowork. */

export type DialogueAct =
  | 'phatic'
  | 'backchannel'
  | 'continuation'
  | 'question'
  | 'fresh_information'
  | 'action'
  | 'emotional_disclosure'
  | 'opinion'
  | 'agreement'
  | 'disagreement'
  | 'clarification'
  | 'correction'
  | 'closing';

export type ConversationDepth = 'brief' | 'standard' | 'developed' | 'deliberative';

export type DeliberationPhase =
  | 'idle'
  | 'opening'
  | 'exploring'
  | 'challenging'
  | 'integrating'
  | 'closing';

/**
 * Compact, deterministic working state for an argued conversation. Excerpts
 * are bounded by the reducer and remain evidence, never model-authored facts.
 */
export interface DeliberationThreadSnapshot {
  active: boolean;
  phase: DeliberationPhase;
  turnCount: number;
  topicTerms: string[];
  continuedFromHistory: boolean;
  topicShifted: boolean;
  userPosition?: string;
  assistantPosition?: string;
  lastReason?: string;
  objection?: string;
  correction?: string;
  openQuestion?: string;
}

export type DiscourseMove =
  | 'acknowledge'
  | 'reflect'
  | 'clarify'
  | 'direct_answer'
  | 'position'
  | 'reason'
  | 'evidence'
  | 'example'
  | 'significance'
  | 'counterpoint'
  | 'concession'
  | 'synthesis'
  | 'freshness'
  | 'source'
  | 'invitation';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationAnalysis {
  act: DialogueAct;
  depth: ConversationDepth;
  needsFreshContext: boolean;
  isEmotional: boolean;
  isFollowUp: boolean;
  continuesDeliberation: boolean;
  deliberationPhase: DeliberationPhase;
  confidence: number;
  salientTerms: string[];
}

export interface ConversationPlan {
  analysis: ConversationAnalysis;
  deliberation: DeliberationThreadSnapshot;
  /** Convenient aliases for consumers that only need the routing decision. */
  act: DialogueAct;
  depth: ConversationDepth;
  moves: DiscourseMove[];
  minSentences: number;
  maxSentences: number;
  targetTokens: number;
  askFollowUp: boolean;
  guidance: string;
}

export interface CommonGroundSnapshot {
  focus: string[];
  accepted: string[];
  disputed: string[];
  openQuestions: string[];
  recentTurns: ConversationTurn[];
  deliberation: DeliberationThreadSnapshot;
}

export interface ConversationReply {
  speech: string;
  text?: string;
  intent: DialogueAct;
  depth: ConversationDepth;
  route: 'instant' | 'companion' | 'grounded' | 'fresh-cache' | 'fallback';
  citations?: Array<{
    title: string;
    url: string;
    source?: string;
    publishedAt?: string;
  }>;
  freshness?: {
    fetchedAt: number;
    state: 'fresh' | 'stale';
  };
  recoverableError?: string;
}
