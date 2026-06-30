/**
 * Query Classifier — classifies user messages by complexity
 * to gate context injection and reduce token waste.
 *
 * @module agent/execution/query-classifier
 */

export type QueryComplexity = 'trivial' | 'simple' | 'complex';

export interface ContextInjectionLevel {
  workspace: boolean;
  lessons: boolean;
  knowledgeGraph: boolean;
  decisionMemory: boolean;
  icmMemory: boolean;
  codeGraph: boolean;
  docs: boolean;
  todo: boolean;
  /** Collective Knowledge Graph (shared cross-agent memory). Optional → opt-in (Phase 0). */
  collectiveGraph?: boolean;
}

const INJECTION_LEVELS: Record<QueryComplexity, ContextInjectionLevel> = {
  trivial: {
    workspace: false, lessons: false, knowledgeGraph: false,
    decisionMemory: false, icmMemory: false, codeGraph: false, docs: false, todo: false,
  },
  simple: {
    workspace: false, lessons: true, knowledgeGraph: true,
    decisionMemory: false, icmMemory: false, codeGraph: false, docs: false, todo: true,
    collectiveGraph: true,
  },
  complex: {
    workspace: true, lessons: true, knowledgeGraph: true,
    decisionMemory: true, icmMemory: true, codeGraph: true, docs: true, todo: true,
    collectiveGraph: true,
  },
};

const GREETING_PATTERNS = /^(h(ello|i|ey|owdy)|bonjour|salut|coucou|hola|ciao|guten\s*tag|yo|sup|what'?s?\s*up|good\s*(morning|afternoon|evening|night)|bonsoir)[\s!?.,:;]*$/i;
const THANKS_PATTERNS = /^(thanks?|thank\s*you|merci|gracias|danke|thx|ty|cheers|appreciate\s*it|bien\s*joué|parfait|excellent|super|cool|nice|great|awesome|génial|bravo)[\s!?.,:;]*$/i;
const YES_NO_PATTERNS = /^(y(es|eah|ep|up)?|no(pe|n)?|ok(ay)?|oui|non|si|nah|sure|nope|d'accord|c'est\s*bon|ça\s*marche|go|do\s*it|vas-y|allez|je\s*valide|validé?)[\s!?.,:;]*$/i;
const FAREWELL_PATTERNS = /^(bye|goodbye|au\s*revoir|à\s*(plus|bientôt)|ciao|adieu|see\s*ya|later|quit|exit|à\+)[\s!?.,:;]*$/i;
const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s]+$/u;
const CODE_SIGNALS = /\b(fix|bug|error|implement|refactor|create|add|remove|delete|update|modify|change|write|build|deploy|test|debug|install|migrate|upgrade|import|export|function|class|method|variable|file|component|module|api|endpoint|route|database|query|schema|config|hook|middleware|provider|service|tool|command|script|pipeline|workflow|agent)\b/i;
const MULTI_ACTION = /\b(and\s+then|also|additionally|plus|as\s+well|in\s+addition|furthermore|ensuite|puis|et\s+aussi|également)\b/i;

export function classifyQuery(message: string): {
  complexity: QueryComplexity;
  injection: ContextInjectionLevel;
} {
  const trimmed = message.trim();
  if (trimmed.length <= 2) {
    return { complexity: 'trivial', injection: INJECTION_LEVELS.trivial };
  }
  if (GREETING_PATTERNS.test(trimmed) || THANKS_PATTERNS.test(trimmed) ||
      YES_NO_PATTERNS.test(trimmed) || FAREWELL_PATTERNS.test(trimmed) ||
      EMOJI_ONLY.test(trimmed)) {
    return { complexity: 'trivial', injection: INJECTION_LEVELS.trivial };
  }
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 8 && !CODE_SIGNALS.test(trimmed) && !MULTI_ACTION.test(trimmed)) {
    return { complexity: 'simple', injection: INJECTION_LEVELS.simple };
  }
  if (CODE_SIGNALS.test(trimmed) || MULTI_ACTION.test(trimmed) || wordCount > 20) {
    return { complexity: 'complex', injection: INJECTION_LEVELS.complex };
  }
  return { complexity: 'simple', injection: INJECTION_LEVELS.simple };
}

export function getInjectionLevel(complexity: QueryComplexity): ContextInjectionLevel {
  return INJECTION_LEVELS[complexity];
}
