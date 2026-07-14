/**
 * A warm Cowork agent must receive cross-channel messages that arrived after
 * its first turn. The host sends the complete visible transcript each time;
 * the adapter therefore has to add only the delta, not replay that transcript.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

let constructorCount = 0;
let observedModelTurns: RecordedMessage[][] = [];
let observedRecoverySessions: Array<string | undefined> = [];
let observedStreamOptions: Array<
  {
    transientContext?: string;
    relationshipSafety?: boolean;
    surface?: string;
  } | undefined
> = [];

class FakeCodeBuddyAgent {
  private history: RecordedMessage[] = [];

  constructor() {
    constructorCount += 1;
  }

  addToHistory(message: RecordedMessage): void {
    this.history.push({ ...message });
  }

  setWorkingDirectory(): void {}

  setRecoverySessionId(sessionId: string | undefined): void {
    observedRecoverySessions.push(sessionId);
  }

  setSystemPromptAppend(): void {}

  dispose(): void {}

  async *processUserMessageStream(
    prompt: string,
    options?: {
      transientContext?: string;
      relationshipSafety?: boolean;
      surface?: string;
    },
  ) {
    observedStreamOptions.push(options);
    this.history.push({ role: 'user', content: prompt });
    const modelTurn = this.history.map((message) => ({ ...message }));
    if (options?.transientContext) {
      modelTurn.push({
        role: 'system',
        content: `<companion_current_turn_context ephemeral="true">\n${options.transientContext}\n</companion_current_turn_context>`,
      });
    }
    observedModelTurns.push(modelTurn);

    if (prompt === 'Tour provider en erreur.') {
      throw new Error('provider stream failed');
    }

    const response = `Réponse à: ${prompt}`;
    this.history.push({ role: 'assistant', content: response });
    yield { type: 'content', content: response };
    yield { type: 'done' };
  }
}

vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: FakeCodeBuddyAgent,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { CodeBuddyEngineAdapter } from '../../src/desktop/codebuddy-engine-adapter.js';

describe('CodeBuddyEngineAdapter warm-session continuity', () => {
  beforeEach(() => {
    constructorCount = 0;
    observedModelTurns = [];
    observedRecoverySessions = [];
    observedStreamOptions = [];
  });

  it('injects newly arrived channel context once without recreating the agent', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'test', model: 'test-model' });
    const voiceContext = 'Voix: je préfère reprendre ce sujet demain matin.';
    const telegramContext = 'Telegram: finalement, reparlons-en ce soir.';
    const firstPrompt = 'Note cette préférence.';
    const firstResponse = `Réponse à: ${firstPrompt}`;

    await adapter.runSession(
      'companion-session',
      [
        { role: 'user', content: voiceContext },
        { role: 'user', content: firstPrompt },
      ],
      () => undefined,
    );

    await adapter.runSession(
      'companion-session',
      [
        // The bridge repeats prior shared context on every turn.
        { role: 'user', content: voiceContext },
        // This message arrived on Telegram while the Cowork agent stayed warm.
        { role: 'user', content: telegramContext },
        { role: 'user', content: firstPrompt },
        { role: 'assistant', content: firstResponse },
        { role: 'user', content: 'Que proposes-tu maintenant ?' },
      ],
      () => undefined,
    );

    expect(constructorCount).toBe(1);
    expect(observedModelTurns).toHaveLength(2);
    expect(observedStreamOptions).toHaveLength(2);
    expect(observedStreamOptions.every((options) => options?.surface === 'cowork')).toBe(true);
    expect(observedRecoverySessions).toEqual([
      'companion-session',
      'companion-session',
    ]);

    const secondTurn = observedModelTurns[1] ?? [];
    expect(secondTurn.some((message) => message.content === telegramContext)).toBe(true);
    expect(secondTurn.filter((message) => message.content === telegramContext)).toHaveLength(1);
    expect(secondTurn.filter((message) => message.content === voiceContext)).toHaveLength(1);
    expect(secondTurn.filter((message) => message.content === firstPrompt)).toHaveLength(1);
    expect(secondTurn.filter((message) => message.content === firstResponse)).toHaveLength(1);
  });

  it('keeps occurrence counts when identical context is repeated legitimately', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'test', model: 'test-model' });
    const repeated = 'Oui, je confirme.';
    const firstPrompt = 'Première question';

    await adapter.runSession(
      'repeated-session',
      [
        { role: 'user', content: repeated },
        { role: 'user', content: firstPrompt },
      ],
      () => undefined,
    );

    await adapter.runSession(
      'repeated-session',
      [
        { role: 'user', content: repeated },
        { role: 'user', content: repeated },
        { role: 'user', content: firstPrompt },
        { role: 'assistant', content: `Réponse à: ${firstPrompt}` },
        { role: 'user', content: 'Deuxième question' },
      ],
      () => undefined,
    );

    const secondTurn = observedModelTurns[1] ?? [];
    expect(secondTurn.filter((message) => message.content === repeated)).toHaveLength(2);
  });

  it('detects an identical new external event when the old event leaves the host window', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'test', model: 'test-model' });
    const repeated = 'Même texte, nouvel événement vocal.';
    const firstPrompt = 'Première question';

    await adapter.runSession(
      'bounded-window-session',
      [
        { role: 'user', content: repeated, contextId: 'voice-event-old' },
        { role: 'user', content: firstPrompt },
      ],
      () => undefined,
    );

    await adapter.runSession(
      'bounded-window-session',
      [
        // The old event fell out of Cowork's bounded shared-history window.
        { role: 'user', content: repeated, contextId: 'voice-event-new' },
        { role: 'user', content: firstPrompt },
        { role: 'assistant', content: `Réponse à: ${firstPrompt}` },
        { role: 'user', content: 'Deuxième question' },
      ],
      () => undefined,
    );

    const secondTurn = observedModelTurns[1] ?? [];
    expect(secondTurn.filter((message) => message.content === repeated)).toHaveLength(2);
  });

  it('applies changing per-turn context without recreating the warm agent or polluting host deltas', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'test', model: 'test-model' });
    const first = await adapter.runSession(
      'transient-context-session',
      [{ role: 'user', content: 'Premier message brut.' }],
      () => undefined,
      { currentTurnContext: 'Dernière surface : voix.' },
    );

    await adapter.runSession(
      'transient-context-session',
      [
        { role: 'user', content: 'Premier message brut.' },
        { role: 'assistant', content: first.content },
        { role: 'user', content: 'Second message brut.' },
      ],
      () => undefined,
      { currentTurnContext: 'Soutien encore ouvert : oui.' },
    );

    expect(constructorCount).toBe(1);
    const firstModelPrompt = observedModelTurns[0]?.at(-1)?.content ?? '';
    const secondTurn = observedModelTurns[1] ?? [];
    const secondModelPrompt = secondTurn.at(-1)?.content ?? '';
    expect(firstModelPrompt).toContain('Dernière surface : voix.');
    expect(firstModelPrompt).not.toContain('Premier message brut.');
    expect(secondModelPrompt).toContain('Soutien encore ouvert : oui.');
    expect(secondModelPrompt).not.toContain('Second message brut.');
    expect(secondTurn.some((message) => message.content === 'Second message brut.')).toBe(true);
    expect(secondTurn.some((message) => message.content.includes('Dernière surface : voix.'))).toBe(false);
    expect(
      secondTurn.filter((message) => message.content === 'Premier message brut.'),
    ).toHaveLength(1);
  });

  it('evicts an uncertain warm agent after a stream error instead of duplicating its user turn', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'test', model: 'test-model' });
    const failedPrompt = 'Tour provider en erreur.';

    await adapter.runSession(
      'failed-stream-session',
      [{ role: 'user', content: failedPrompt }],
      () => undefined,
    );
    await adapter.runSession(
      'failed-stream-session',
      [
        { role: 'user', content: failedPrompt },
        { role: 'user', content: 'Tour suivant.' },
      ],
      () => undefined,
    );

    expect(constructorCount).toBe(2);
    const recoveryTurn = observedModelTurns[1] ?? [];
    expect(recoveryTurn.filter((message) => message.content === failedPrompt)).toHaveLength(1);
  });
});
