import { redactSecrets } from '../fleet/privacy-lint.js';

interface RedactableRememberInput {
  name?: unknown;
  text?: unknown;
  relations?: unknown;
}

function redactString(value: unknown): unknown {
  return typeof value === 'string' ? redactSecrets(value) : value;
}

/** Clone and redact every user-controlled string persisted by CKG remember/ingest. */
export function redactRememberInput<T extends object>(input: T): T {
  const source = input as T & RedactableRememberInput;
  const output = { ...input } as T & RedactableRememberInput;

  output.name = redactString(source.name);
  output.text = redactString(source.text);
  if (Array.isArray(source.relations)) {
    output.relations = source.relations.map((relation) => {
      if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return relation;
      const relationRecord = relation as Record<string, unknown>;
      return {
        ...relationRecord,
        targetName: redactString(relationRecord.targetName),
        reason: redactString(relationRecord.reason),
      };
    });
  }

  return output;
}
