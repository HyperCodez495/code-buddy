/**
 * Explicit Cowork adapter for the core cross-channel companion journal.
 *
 * Cowork also hosts ordinary coding sessions, so continuity is fail-closed:
 * only a session carrying the durable `companion` (or legacy `lisa`) tag can
 * read or append the private voice/Telegram thread.
 */
import type { Session } from '../../renderer/types';
import { isCompanionThreadTags } from '../../shared/companion-thread';
import { loadCoreModule } from '../utils/core-loader';
import { logError, logWarn } from '../utils/logger';

export type CoworkEngineMessage = {
  role: string;
  content: string;
  /** Stable identity carried only by messages imported from the shared journal. */
  contextId?: string;
};

export type CoworkCanonicalAttachmentKind =
  | 'image'
  | 'document'
  | 'video'
  | 'audio'
  | 'archive'
  | 'file';

/**
 * User-visible, allowlisted representation of a Cowork turn.
 *
 * The engine prompt may additionally contain file excerpts, absolute paths,
 * project memory and mention context. None of that internal material is legal
 * here: this value is the only input that may reach the shared companion
 * journal or a mirrored Telegram message.
 */
export interface CoworkCanonicalTurn {
  text: string;
  attachments?: Array<{ kind: CoworkCanonicalAttachmentKind }>;
}

export function classifyCoworkCanonicalAttachment(input: {
  image?: boolean;
  mimeType?: string;
  filename?: string;
}): CoworkCanonicalAttachmentKind {
  if (input.image) return 'image';
  const mimeType = input.mimeType?.trim().toLowerCase() ?? '';
  const filename = input.filename?.trim().toLowerCase() ?? '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('zip') ||
    mimeType.includes('archive') ||
    /\.(?:zip|7z|rar|tar|tgz|gz)$/i.test(filename)
  ) {
    return 'archive';
  }
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/pdf' ||
    mimeType.includes('document') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation') ||
    /\.(?:txt|md|pdf|docx?|xlsx?|csv|pptx?)$/i.test(filename)
  ) {
    return 'document';
  }
  return 'file';
}

type ConversationRole = 'user' | 'assistant';
type ConversationOrigin = 'voice' | 'channel' | 'cowork';

interface CoreConversationEvent {
  id: string;
  role: ConversationRole;
  content: string;
  origin: ConversationOrigin;
  timestamp: string;
  externalId?: string;
}

interface CoreBridgeConfig {
  enabled: boolean;
  companionName: string;
  conversationId: string;
  coworkEnabled: boolean;
  coworkHistoryTurns: number;
  historyPath: string;
  maxHistoryBytes?: number;
  target?: { channel: string; channelId: string; threadId?: string };
}

interface CoreConversationBridge {
  isActive(): boolean;
  snapshot(): CoreConversationEvent[];
  /** Raw-free, bounded observations; optional for compatibility with an older core bundle. */
  renderRelationshipContext?(): string;
  recordCoworkTurn(
    turn: { role: ConversationRole; content: string },
    input: { sessionId: string; messageId: string },
  ): Promise<boolean>;
  /** Drain pending journal appends and mirrors before Cowork exits or reconfigures. */
  flush?(): Promise<void>;
}

interface CoreBridgeModule {
  CrossChannelConversationBridge: new (
    config: CoreBridgeConfig,
    dependencies?: {
      deliver?: (
        target: { channel: string; channelId: string; threadId?: string },
        content: string,
        contentType: string,
      ) => Promise<boolean>;
    },
  ) => CoreConversationBridge;
  resolveCrossChannelBridgeConfig: (env: Record<string, string | undefined>) => CoreBridgeConfig;
}

interface CoreAssistantConfigModule {
  readAssistantConfig?: () => Record<string, string>;
  readAssistantRuntimeEnv?: () => Record<string, string>;
}

interface CoreCompanionIdentityModule {
  LISA_COMPANION_SYSTEM_PROMPT?: string;
}

interface CorePrefetchedContextModule {
  resolvePrefetchedTurnContextForConversation?: (
    heard: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: { allowStale?: boolean },
  ) => {
    kind: string;
    freshness: 'fresh' | 'stale';
    promptGuidance: string;
  } | null;
  isPrefetchedTurnRequest?: (heard: string) => boolean;
}

interface CorePrefetchEngineModule {
  runPrefetchCycle?: () => Promise<unknown>;
}

type CoreLoader = <T>(relativePath: string) => Promise<T | null>;

export interface PreparedCoworkContinuity {
  active: boolean;
  messages: CoworkEngineMessage[];
  /** Stable identity/instructions. Safe to keep in the cached agent identity. */
  systemPrompt?: string;
  /** Per-turn observations/evidence. Must travel with the current user turn. */
  turnContext?: string;
  /** Public, source-derived fresh context safe for an explicitly selected critic. */
  freshEvidence?: string;
  recordAssistant: (messageId: string, content: string) => void;
}

interface CachedBridge {
  fingerprint: string;
  bridge: CoreConversationBridge;
  config: CoreBridgeConfig;
  identityPrompt: string;
}

const MAX_SHARED_HISTORY_CHARS = 12_000;
const MAX_CANONICAL_ATTACHMENTS = 24;
const CANONICAL_ATTACHMENT_KINDS = new Set<CoworkCanonicalAttachmentKind>([
  'image',
  'document',
  'video',
  'audio',
  'archive',
  'file',
]);
const EMPTY_CONTINUITY: PreparedCoworkContinuity = {
  active: false,
  messages: [],
  recordAssistant: () => undefined,
};

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeCoworkCanonicalTurn(
  input: CoworkCanonicalTurn | string,
): CoworkCanonicalTurn {
  if (typeof input === 'string') return { text: normalizeContent(input) };
  const attachments = Array.isArray(input.attachments)
    ? input.attachments
        .filter(
          (attachment): attachment is { kind: CoworkCanonicalAttachmentKind } =>
            Boolean(attachment) && CANONICAL_ATTACHMENT_KINDS.has(attachment.kind),
        )
        .slice(0, MAX_CANONICAL_ATTACHMENTS)
        .map((attachment) => ({ kind: attachment.kind }))
    : [];
  return {
    text: normalizeContent(typeof input.text === 'string' ? input.text : ''),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** Render only fixed labels and counts; filenames, MIME strings and paths are never accepted. */
export function renderCoworkCanonicalTurn(input: CoworkCanonicalTurn | string): string {
  const canonical = normalizeCoworkCanonicalTurn(input);
  const counts = new Map<CoworkCanonicalAttachmentKind, number>();
  for (const attachment of canonical.attachments ?? []) {
    counts.set(attachment.kind, (counts.get(attachment.kind) ?? 0) + 1);
  }
  const labels: Record<CoworkCanonicalAttachmentKind, [string, string]> = {
    image: ['image', 'images'],
    document: ['document', 'documents'],
    video: ['vidéo', 'vidéos'],
    audio: ['fichier audio', 'fichiers audio'],
    archive: ['archive', 'archives'],
    file: ['fichier', 'fichiers'],
  };
  const attachmentSummary = [...counts.entries()]
    .map(([kind, count]) => `${count} ${labels[kind][count === 1 ? 0 : 1]}`)
    .join(', ');
  return [
    canonical.text,
    attachmentSummary ? `[Pièces jointes : ${attachmentSummary}.]` : '',
  ].filter(Boolean).join('\n\n');
}

function messageFingerprint(role: string, content: string): string {
  return `${role}:${normalizeContent(content).toLocaleLowerCase('fr')}`;
}

function configFingerprint(config: CoreBridgeConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    companionName: config.companionName,
    conversationId: config.conversationId,
    coworkEnabled: config.coworkEnabled,
    coworkHistoryTurns: config.coworkHistoryTurns,
    historyPath: config.historyPath,
    maxHistoryBytes: config.maxHistoryBytes ?? null,
    target: config.target ?? null,
  });
}

/** Telegram delivery owned by Electron main; credentials never cross IPC. */
export function createCoworkConversationDeliver(
  runtimeEnv: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): (
  target: { channel: string; channelId: string; threadId?: string },
  content: string,
) => Promise<boolean> {
  return async (target, content) => {
    if (target.channel !== 'telegram') return false;
    const token = (
      runtimeEnv.CODEBUDDY_SENSORY_ALERT_TOKEN
      || runtimeEnv.TELEGRAM_BOT_TOKEN
      || ''
    ).trim();
    if (!token || !target.channelId.trim() || !content.trim()) return false;

    const threadNumber = Number(target.threadId);
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.channelId,
        text: content,
        ...(target.threadId && Number.isSafeInteger(threadNumber)
          ? { message_thread_id: threadNumber }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  };
}

function boundedHistory(
  events: CoreConversationEvent[],
  limit: number,
): CoreConversationEvent[] {
  const selected: CoreConversationEvent[] = [];
  let chars = 0;
  for (let index = events.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const length = event.content.length;
    const remaining = MAX_SHARED_HISTORY_CHARS - chars;
    if (length > remaining) {
      // The newest event must obey the same total cap. Retain a bounded head
      // instead of allowing one oversized journal entry to bypass the limit.
      if (selected.length === 0 && remaining > 0) {
        selected.push({ ...event, content: event.content.slice(0, remaining) });
      }
      break;
    }
    selected.push(event);
    chars += length;
  }
  return selected.reverse();
}

export class CoworkCrossChannelContinuity {
  private cached?: CachedBridge;

  constructor(
    private readonly coreLoader: CoreLoader = <T>(relativePath: string) =>
      loadCoreModule<T>(relativePath),
  ) {}

  /** Await every pending shared-journal append and channel mirror. */
  async flush(): Promise<void> {
    await this.cached?.bridge.flush?.();
  }

  async prepare(
    session: Session,
    localMessages: CoworkEngineMessage[],
    currentTurn: CoworkCanonicalTurn | string,
    userMessageId: string,
  ): Promise<PreparedCoworkContinuity> {
    if (!isCompanionThreadTags(session.tags)) return EMPTY_CONTINUITY;

    const canonicalTurn = normalizeCoworkCanonicalTurn(currentTurn);
    const canonicalContent = renderCoworkCanonicalTurn(canonicalTurn);

    try {
      const [state, freshContext] = await Promise.all([
        this.resolveBridge(),
        this.resolveFreshContext(
          canonicalTurn.text || canonicalContent,
          localMessages,
        ),
      ]);
      const freshContextPrompt = freshContext.promptGuidance;
      const freshEvidence = freshContext.kind === 'news' ? freshContextPrompt : undefined;
      if (!state || !state.config.coworkEnabled || !state.bridge.isActive()) {
        return freshContextPrompt
          ? {
              ...EMPTY_CONTINUITY,
              turnContext: freshContextPrompt,
              ...(freshEvidence ? { freshEvidence } : {}),
            }
          : EMPTY_CONTINUITY;
      }

      const localFingerprints = new Set(
        [...localMessages, { role: 'user', content: canonicalContent }]
          .map((message) => messageFingerprint(message.role, message.content)),
      );
      const sessionPrefix = `${session.id}:`;
      const eligible = state.bridge.snapshot().filter((event) => {
        if (event.origin === 'cowork' && event.externalId?.startsWith(sessionPrefix)) return false;
        return !localFingerprints.has(messageFingerprint(event.role, event.content));
      });
      const history = boundedHistory(eligible, state.config.coworkHistoryTurns).map((event) => ({
        role: event.role,
        content: event.content,
        contextId: event.id,
      }));

      this.recordTurn(state.bridge, session.id, userMessageId, 'user', canonicalContent);
      const relationshipContext = state.bridge.renderRelationshipContext?.().trim() ?? '';

      const companionName = state.config.companionName || 'Lisa';
      return {
        active: true,
        messages: history,
        systemPrompt: [
          state.identityPrompt,
          '# Continuité multimodale explicite',
          `Cette session Cowork est reliée au fil personnel de ${companionName}.`,
          'Les messages antérieurs injectés peuvent provenir de la voix, de Telegram ou d\'une autre session Cowork reliée.',
          'Reprends naturellement le dernier sujet utile sans annoncer un changement de canal. Ne confonds jamais ce fil avec une session Cowork non reliée.',
        ].filter(Boolean).join('\n\n'),
        turnContext: [relationshipContext, freshContextPrompt]
          .filter(Boolean)
          .join('\n\n') || undefined,
        ...(freshEvidence ? { freshEvidence } : {}),
        recordAssistant: (messageId, content) => {
          this.recordTurn(state.bridge, session.id, messageId, 'assistant', content);
        },
      };
    } catch (error) {
      logWarn(
        '[CoworkContinuity] shared companion thread unavailable:',
        error instanceof Error ? error.message : String(error),
      );
      return EMPTY_CONTINUITY;
    }
  }

  private async resolveBridge(): Promise<CachedBridge | null> {
    const [bridgeModule, assistantModule, identityModule] = await Promise.all([
      this.coreLoader<CoreBridgeModule>('conversation/cross-channel-bridge.js'),
      this.coreLoader<CoreAssistantConfigModule>('companion/assistant-config.js'),
      this.coreLoader<CoreCompanionIdentityModule>('identity/companion-identity.js'),
    ]);
    if (!bridgeModule?.CrossChannelConversationBridge || !bridgeModule.resolveCrossChannelBridgeConfig) {
      return null;
    }

    const runtimeEnv = assistantModule?.readAssistantRuntimeEnv?.() ?? {};
    const saved = assistantModule?.readAssistantConfig?.() ?? {};
    const mergedEnv = { ...process.env, ...runtimeEnv, ...saved };
    const config = bridgeModule.resolveCrossChannelBridgeConfig(mergedEnv);
    const fingerprint = configFingerprint(config);
    if (this.cached?.fingerprint === fingerprint) return this.cached;

    // A runtime config change must not abandon events queued on the previous
    // bridge just before the new target/fingerprint becomes active.
    await this.cached?.bridge.flush?.();

    this.cached = {
      fingerprint,
      bridge: new bridgeModule.CrossChannelConversationBridge(config, {
        deliver: createCoworkConversationDeliver(mergedEnv),
      }),
      config,
      identityPrompt: identityModule?.LISA_COMPANION_SYSTEM_PROMPT?.trim() ?? '',
    };
    return this.cached;
  }

  private async resolveFreshContext(
    prompt: string,
    history: CoworkEngineMessage[],
  ): Promise<{ kind?: string; promptGuidance: string }> {
    if (process.env.CODEBUDDY_PREFETCH === 'false') return { promptGuidance: '' };
    const [contextModule, engineModule] = await Promise.all([
      this.coreLoader<CorePrefetchedContextModule>(
        'conversation/prefetched-turn-context.js',
      ),
      this.coreLoader<CorePrefetchEngineModule>('companion/prefetch-engine.js'),
    ]);
    const conversationHistory = history.flatMap(
      (message): Array<{ role: 'user' | 'assistant'; content: string }> =>
        message.role === 'user' || message.role === 'assistant'
          ? [{ role: message.role, content: message.content }]
          : [],
    );
    const context = contextModule?.resolvePrefetchedTurnContextForConversation?.(
      prompt,
      conversationHistory,
      { allowStale: true },
    );
    if (
      context?.freshness === 'stale' ||
      (!context && contextModule?.isPrefetchedTurnRequest?.(prompt))
    ) {
      void engineModule?.runPrefetchCycle?.().catch((error) =>
        logWarn(
          '[CoworkContinuity] fresh-context refresh failed:',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    return {
      ...(context?.kind ? { kind: context.kind } : {}),
      promptGuidance: context?.promptGuidance?.trim() ?? '',
    };
  }

  private recordTurn(
    bridge: CoreConversationBridge,
    sessionId: string,
    messageId: string,
    role: ConversationRole,
    content: string,
  ): void {
    const normalized = normalizeContent(content);
    if (!normalized) return;
    void bridge
      .recordCoworkTurn({ role, content: normalized }, { sessionId, messageId })
      .catch((error) => logError('[CoworkContinuity] failed to record turn:', error));
  }
}
