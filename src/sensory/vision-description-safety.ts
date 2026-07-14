import { redactSecrets as redactPrivacySecrets } from '../fleet/privacy-lint.js';

function canonicalizeVisionText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x200b && codePoint <= 0x200d) || codePoint === 0xfeff) return '';
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('');
}

/** Normalize local VLM output without pretending to understand its semantics. */
export function normalizeVisionDescription(
  value: unknown,
  maxChars = 500,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const limit = Math.max(1, Math.floor(maxChars));
  const normalized = canonicalizeVisionText(value).replace(/\s+/g, ' ').trim().slice(0, limit);
  return normalized || undefined;
}

/** Heuristic secret/PII/path redaction for an explicitly authorised egress. */
export function redactVisionDescriptionForEgress(
  value: string,
  maxChars = 500,
): string | undefined {
  const redacted = redactPrivacySecrets(canonicalizeVisionText(value))
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      '[REDACTED:pii-email]',
    )
    .replace(
      /(?:\b[A-Za-z]:\\|\B\/)(?:[^\s,;:"'<>]|\\ )+/g,
      '[REDACTED:path]',
    );
  return normalizeVisionDescription(redacted, maxChars);
}
