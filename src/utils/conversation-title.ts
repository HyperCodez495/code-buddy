/**
 * Conversation Auto-Title Generation
 *
 * Generates a short descriptive title from the first user message
 * using heuristic rules (no LLM call needed).
 */

/** Known action verb prefixes that serve as good title starters */
const ACTION_PREFIXES = [
  'fix', 'debug', 'add', 'create', 'refactor', 'update', 'remove',
  'delete', 'implement', 'build', 'write', 'test', 'deploy',
  'configure', 'setup', 'install', 'migrate', 'optimize',
  'review', 'explain', 'analyze', 'find', 'search', 'help',
  'improve', 'upgrade', 'convert', 'move', 'rename', 'merge',
];

/** Maximum title length */
const MAX_TITLE_LENGTH = 60;

/**
 * Generate a conversation title from the first user message.
 *
 * Rules:
 * - Max 60 characters
 * - If starts with a known action verb, capitalize and use as prefix
 * - Extract the main subject (file name, feature name, error message)
 * - Fallback: first 50 chars of message + "..."
 */
export function generateConversationTitle(firstMessage: string): string {
  if (!firstMessage || typeof firstMessage !== 'string') {
    return 'New conversation';
  }

  // Clean up: remove leading/trailing whitespace, collapse whitespace
  const cleaned = firstMessage.trim().replace(/\s+/g, ' ');

  if (cleaned.length === 0) {
    return 'New conversation';
  }

  // Try to extract a meaningful title
  const title = extractTitle(cleaned);

  // Enforce length limit
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }

  return title.substring(0, MAX_TITLE_LENGTH - 3).trimEnd() + '...';
}

function extractTitle(message: string): string {
  const firstWord = (message.split(/\s+/)[0] ?? '').toLowerCase();

  // Check if message starts with a known action verb
  const matchedPrefix = ACTION_PREFIXES.find(p => firstWord === p);

  if (matchedPrefix) {
    // Use the action verb as a capitalized prefix
    const capitalized = matchedPrefix.charAt(0).toUpperCase() + matchedPrefix.slice(1);
    const rest = message.substring(matchedPrefix.length).trim();

    // Extract a concise subject from the rest
    const subject = extractSubject(rest);
    if (subject) {
      return `${capitalized} ${subject}`;
    }
    return `${capitalized}: ${truncate(rest, MAX_TITLE_LENGTH - capitalized.length - 2)}`;
  }

  // Check for file paths in the message (common in coding conversations)
  const fileMatch = message.match(/\b[\w\-./]+\.(ts|tsx|js|jsx|py|go|rs|java|rb|cpp|c|h|css|html|md|json|yaml|yml|toml)\b/);
  if (fileMatch) {
    const fileName = fileMatch[0].split('/').pop() || fileMatch[0];
    const context = extractContext(message, fileMatch[0]);
    if (context) {
      return `${context} ${fileName}`;
    }
    return `Work on ${fileName}`;
  }

  // Check for error messages (common debugging conversations)
  const errorMatch = message.match(/\b(?:error|exception|TypeError|ReferenceError|SyntaxError|cannot|failed|broken|crash|bug)\b/i);
  if (errorMatch) {
    return truncate(message, MAX_TITLE_LENGTH);
  }

  // Check if it's a question
  if (message.endsWith('?') || /^(?:how|what|why|when|where|can|could|should|is|are|do|does)\b/i.test(message)) {
    return truncate(message, MAX_TITLE_LENGTH);
  }

  // Default: use first sentence or truncate
  const firstSentence = (message.split(/[.!?\n]/)[0] ?? '').trim();
  if (firstSentence.length > 0 && firstSentence.length <= MAX_TITLE_LENGTH) {
    return firstSentence;
  }

  return truncate(message, MAX_TITLE_LENGTH);
}

/**
 * Extract a concise subject from text following an action verb.
 */
function extractSubject(text: string): string | null {
  if (!text) return null;

  // Remove common filler words at the start
  const withoutFillers = text.replace(/^(?:the|a|an|this|my|our|some)\s+/i, '');

  // Take the first meaningful phrase (up to a comma, period, or newline)
  const phrase = (withoutFillers.split(/[,.\n]/)[0] ?? '').trim();

  if (phrase.length > 0 && phrase.length <= MAX_TITLE_LENGTH - 10) {
    return phrase;
  }

  // Truncate if still too long
  if (phrase.length > 0) {
    return truncate(phrase, MAX_TITLE_LENGTH - 10);
  }

  return null;
}

/**
 * Extract contextual action from message around a file reference.
 */
function extractContext(message: string, _filePath: string): string | null {
  const lower = message.toLowerCase();
  for (const prefix of ACTION_PREFIXES) {
    if (lower.includes(prefix)) {
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
  }
  return null;
}

/**
 * Truncate a string to maxLen, adding "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3).trimEnd() + '...';
}
